// パスワード再設定（forgot-password / reset-password）のルートハンドラ。
//
// worker/auth/routes.ts ではなくこちらに分離する理由: routes.ts は既存21件の
// テストが分岐を厳密に固定している。差分をそこに混ぜず、レビュー対象を
// このファイルに閉じ込めるため。ディスパッチの合流は worker/index.ts で行う。

import { normalizeEmail } from "../../shared/auth/email";
import {
  consumePasswordReset,
  createPasswordReset,
  deleteAllSessionsForUser,
  findUserByEmail,
  updatePasswordHash,
} from "../db";
import { sendPasswordResetMail } from "../email";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import { checkAndBump, hashForKey, todayUtc } from "../rateLimit";
import { hashClientKey, readClientKeyInput } from "./password";
import { hashToken, newSessionToken } from "./session";

// 再設定トークンの有効期限（分）。sendPasswordResetMail の文面にもそのまま使う
export const RESET_TOKEN_TTL_MINUTES = 30;

// メールアドレス別・1日あたりの forgot-password 上限。
//
// ⚠️ IPではなくアドレス単位にする。ここでの目的は「他人のメールボックスを
// 再設定メールで埋め尽くされない」ことであり、IP単位の枠だと同一IPから
// 複数アドレス分の被害を防げない。
const FORGOT_PASSWORD_EMAIL_DAILY_LIMIT = 5;

function invalidInput(): Response {
  return errorResponse("INVALID_INPUT", "入力が不正です", 400);
}

/** トークンが無効（存在しない／使用済み／期限切れ）だったときの応答。区別しない。 */
function resetTokenInvalid(): Response {
  return errorResponse(
    "RESET_TOKEN_INVALID",
    "このリンクは無効か、有効期限が切れています。再度パスワード再設定をお試しください",
    400,
  );
}

/** リクエストボディを安全に JSON として読む。壊れた本文でも例外を投げない。 */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resetExpiryIso(from: Date = new Date()): string {
  return new Date(from.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
}

/**
 * リクエストの origin をメール本文のリンク組み立てに使う `appUrl` とする。
 *
 * 専用の環境変数を増やさずに済ませるための選択。本番ではカスタムドメイン
 * （lifeplan.nexeed-lab.com）がそのまま origin になり、ローカル開発でも
 * localhost の origin がそのまま使えるため、環境ごとの出し分けが要らない。
 */
function appUrlFromRequest(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * `POST /api/auth/forgot-password`。
 *
 * ⚠️ 応答は常に `200 { ok: true }`。アドレスが登録済みかどうかで応答を
 * 変えない（列挙対策）。メール送信に失敗しても応答は変えない
 * （原因は console.error にだけ残す）。
 *
 * レート制限はアドレスが未登録でも必ず消費する。「登録済みのときだけ枠を
 * 使う」形にすると、同じアドレスに何度もリクエストしたときの挙動の違い
 * （＝枠が減るかどうか）から存在の有無が漏れる。
 */
async function handleForgotPassword(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJsonBody(request);
  const email = body ? normalizeEmail(body.email) : null;

  // メール形式が不正なだけの場合も、以降の分岐（登録済みかどうか）と
  // 応答を区別しない。常にここで同じ 200 を返す。
  if (!email) return json({ ok: true });

  const rateLimitKey = `rl:forgot-password:${todayUtc()}:${await hashForKey(email)}`;
  const allowed = await checkAndBump(env.RATE_LIMIT, rateLimitKey, FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);

  // 上限に達していたら、トークン発行もメール送信もしない。ここで応答を
  // 変えないのは同じ理由（枠を使い切ったかどうかが外から見えると、
  // 「これは登録済みアドレスだ」という手がかりになりうる）。
  if (allowed) {
    const user = await findUserByEmail(env.DB, email);
    if (user) {
      const token = newSessionToken();
      await createPasswordReset(env.DB, {
        tokenHash: await hashToken(token),
        userId: user.id,
        expiresAt: resetExpiryIso(),
      });

      try {
        await sendPasswordResetMail({
          to: email,
          token,
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
          apiKey: env.RESEND_API_KEY,
          from: env.MAIL_FROM,
          appUrl: appUrlFromRequest(request),
        });
      } catch (err) {
        // 送信失敗の詳細（宛先を含みうる）は応答に出さず、ログにだけ残す
        console.error(err);
      }
    }
  }

  return json({ ok: true });
}

/**
 * `POST /api/auth/reset-password`。
 *
 * トークンの検証と使用済み化は db.ts の consumePasswordReset が原子的に行う
 * （このハンドラ側で「検証してから使用済みにする」という2ステップを
 * 組んでしまうと、その隙間で同じトークンが2回使える）。
 *
 * 成功したらそのユーザーの全セッションを削除し、**自動ログインはしない**
 * （Set-Cookie を出さない）。新しいパスワードで入り直してもらう。
 */
async function handleResetPassword(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return invalidInput();

  const token = typeof body.token === "string" && body.token.length > 0 ? body.token : null;
  const keyInput = readClientKeyInput(body);
  if (!token || !keyInput) return invalidInput();

  const userId = await consumePasswordReset(env.DB, await hashToken(token), new Date());
  if (!userId) return resetTokenInvalid();

  const passwordHash = await hashClientKey(keyInput.key, keyInput.kdfVersion);
  await updatePasswordHash(env.DB, userId, passwordHash);
  await deleteAllSessionsForUser(env.DB, userId);

  return json({ ok: true });
}

type Handler = (request: Request, env: AppEnv) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  "POST /api/auth/forgot-password": handleForgotPassword,
  "POST /api/auth/reset-password": handleResetPassword,
};

const KNOWN_PATHS = new Set(Object.keys(ROUTES).map((key) => key.split(" ", 2)[1]));

/**
 * `/api/auth/forgot-password`・`/api/auth/reset-password` のディスパッチ。
 * worker/auth/routes.ts の handleAuthRoute と同じ形にして、呼び出し側
 * （worker/index.ts）から並べて呼べるようにする。
 */
export async function handleResetRoute(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response | null> {
  const handler = ROUTES[`${request.method} ${url.pathname}`];
  if (handler) return handler(request, env);
  if (KNOWN_PATHS.has(url.pathname)) {
    return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
  }
  return null;
}
