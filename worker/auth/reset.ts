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
import { checkIpRateLimit } from "./routes";
import { hashClientKey, readClientKeyInput } from "./password";
import { hashToken, newSessionToken } from "./session";

// 再設定トークンの有効期限（分）。sendPasswordResetMail の文面にもそのまま使う
export const RESET_TOKEN_TTL_MINUTES = 30;

// メールアドレス別・1日あたりの forgot-password 上限。
//
// ⚠️ IPではなくアドレス単位。ここでの目的は「他人のメールボックスを
// 再設定メールで埋め尽くされない」ことであり、IP単位の枠だけだと同一IPから
// 複数アドレス分の被害を防げない（下の FORGOT_PASSWORD_IP_DAILY_LIMIT と併用する）。
const FORGOT_PASSWORD_EMAIL_DAILY_LIMIT = 5;

// IP別・1日あたりの forgot-password 上限。
//
// アドレス単位の枠だけでは、1つのIPが別々のアドレスへ何度でも投げられる
// （① 登録済み／未登録の応答時間差を突いた総当たり、② 流出リストの
// アドレスへ Resend の送信枠を枯渇させる目的の乱打、のいずれも防げない）。
// signup（10回/日）・login（30回/日）の考え方に揃え、乱打を頭打ちにする。
const FORGOT_PASSWORD_IP_DAILY_LIMIT = 30;

// IP別・1日あたりの reset-password 上限。
//
// トークンは256bitの乱数なので総当たりは現実的に成立しないが、無認証で
// D1 の UPDATE を無制限に発行できる経路をそのまま残す理由もないため、緩く絞る。
const RESET_PASSWORD_IP_DAILY_LIMIT = 60;

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

/**
 * レート制限に引っかかったときの応答（reset-password 用）。
 *
 * ⚠️ forgot-password では絶対に使わないこと。forgot-password は
 * アドレスの有無に関わらず常に 200 { ok: true } を返す必要があり、ここで
 * 429 を返すと「上限に達したかどうか」という新しい分岐が外から見える形で
 * 生まれ、かえって情報が漏れる。reset-password はトークンの有効性で
 * 既に応答が分かれる（RESET_TOKEN_INVALID）ため、この制約を持たない。
 */
function rateLimited(): Response {
  return errorResponse("RATE_LIMITED", "しばらく時間をおいてから再度お試しください", 429);
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
 * トークン発行・D1 書き込み・メール送信をまとめて行う。
 *
 * `handleForgotPassword` から `ctx.waitUntil()` に載せて呼ぶ前提。
 * 応答を返した後に実行されるため、ここで投げた例外は誰も待っていない
 * （`sendPasswordResetMail` の失敗は関数内で握りつぶし、それ以外の
 * 予期しない例外は Workers のランタイムログに出るだけで応答には影響しない）。
 */
async function issuePasswordResetAndSendMail(env: AppEnv, userId: string, email: string): Promise<void> {
  const token = newSessionToken();
  await createPasswordReset(env.DB, {
    tokenHash: await hashToken(token),
    userId,
    expiresAt: resetExpiryIso(),
  });

  try {
    await sendPasswordResetMail({
      to: email,
      token,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
      appUrl: env.APP_URL,
    });
  } catch (err) {
    // 送信失敗の詳細（宛先を含みうる）は応答に出さず、ログにだけ残す
    console.error(err);
  }
}

/**
 * `POST /api/auth/forgot-password`。
 *
 * ⚠️ 応答は常に `200 { ok: true }`。アドレスが登録済みかどうかで応答を
 * 変えない（列挙対策）。メール送信に失敗しても応答は変えない
 * （原因は console.error にだけ残す）。
 *
 * ⚠️ **応答時間でも登録済みかどうかを漏らさない。** 登録済みアドレスだけ
 * 追加で D1 への INSERT と Resend への外部HTTP往復が発生すると、本文・
 * ヘッダを完全に揃えても応答時間の差だけで判定できてしまう。そのため
 * `findUserByEmail` までは待ってよいが、その先（トークン発行・DB書き込み・
 * メール送信）は `ctx.waitUntil()` で応答の外へ逃がす。
 *
 * レート制限（アドレス別・IP別の両方）は、アドレスが未登録でも必ず消費する。
 * 「登録済みのときだけ枠を使う」形にすると、同じアドレス／IPに何度も
 * リクエストしたときの挙動の違い（＝枠が減るかどうか）から存在の有無が漏れる。
 * `&&` の短絡評価でどちらかの消費が省略されないよう、個別に await してから
 * 結果をまとめて見る。
 */
async function handleForgotPassword(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const body = await readJsonBody(request);
  const email = body ? normalizeEmail(body.email) : null;

  // メール形式が不正なだけの場合も、以降の分岐（登録済みかどうか）と
  // 応答を区別しない。常にここで同じ 200 を返す。
  if (!email) return json({ ok: true });

  const ip = request.headers.get("cf-connecting-ip");
  const ipAllowed = await checkIpRateLimit(env, ip, "forgot-password", FORGOT_PASSWORD_IP_DAILY_LIMIT);

  const emailRateLimitKey = `rl:forgot-password:${todayUtc()}:${await hashForKey(email)}`;
  const emailAllowed = await checkAndBump(env.RATE_LIMIT, emailRateLimitKey, FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);

  // 上限に達していたら、トークン発行もメール送信もしない。ここでも応答を
  // 変えないのは同じ理由（枠を使い切ったかどうかが外から見えると、
  // 「これは登録済みアドレスだ」という手がかりになりうる）。429は返さない。
  if (ipAllowed && emailAllowed) {
    const user = await findUserByEmail(env.DB, email);
    if (user) {
      // ⚠️ await せず投げっぱなしにしない。Workers は応答を返すと同時に
      // 実行を打ち切りうるため、必ず ctx.waitUntil() に載せて生かし続ける。
      ctx.waitUntil(issuePasswordResetAndSendMail(env, user.id, email));
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
 *
 * IP別の緩いレート制限（60回/日）を先にかける。トークン自体は256bitの
 * 乱数で総当たりは成立しないが、無認証で D1 の UPDATE を無制限に発行できる
 * 経路を残す理由がないため。
 */
async function handleResetPassword(request: Request, env: AppEnv): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!(await checkIpRateLimit(env, ip, "reset-password", RESET_PASSWORD_IP_DAILY_LIMIT))) {
    return rateLimited();
  }

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

type Handler = (request: Request, env: AppEnv, ctx: ExecutionContext) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  "POST /api/auth/forgot-password": handleForgotPassword,
  "POST /api/auth/reset-password": handleResetPassword,
};

const KNOWN_PATHS = new Set(Object.keys(ROUTES).map((key) => key.split(" ", 2)[1]));

/**
 * `/api/auth/forgot-password`・`/api/auth/reset-password` のディスパッチ。
 * worker/auth/routes.ts の handleAuthRoute と同じ形にして、呼び出し側
 * （worker/index.ts）から並べて呼べるようにする。
 *
 * `ctx`（`ExecutionContext`）は forgot-password の `waitUntil` に使うため
 * 必須の引数にしてある（reset-password 側は現状使わないが、呼び出し側の
 * ディスパッチを1本にするため同じシグネチャに揃える）。
 */
export async function handleResetRoute(
  request: Request,
  env: AppEnv,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const handler = ROUTES[`${request.method} ${url.pathname}`];
  if (handler) return handler(request, env, ctx);
  if (KNOWN_PATHS.has(url.pathname)) {
    return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
  }
  return null;
}
