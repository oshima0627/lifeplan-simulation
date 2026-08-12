// 認証APIのルートハンドラ（signup / login / logout / me）。
//
// すべての応答はここから http.ts の json / errorResponse を通して返す
// （cache-control の付け忘れを防ぐという http.ts の不変条件を守るため）。

import { normalizeEmail } from "../../shared/auth/email";
import { buildSetCookie, readCookie, SESSION_COOKIE } from "../cookies";
import { createSession, createUser, deleteSession, findUserByEmail, findUserIdBySession } from "../db";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import { hashClientKey, readClientKeyInput, verifyClientKey } from "./password";
import { hashToken, newSessionToken, sessionExpiryIso, SESSION_TTL_DAYS } from "./session";

/**
 * 登録済みかどうかを応答から判別できないようにするための、単一の失敗文言。
 *
 * 「同じメールで再登録」「間違った鍵でログイン」「存在しないメールでログイン」の
 * 3ケースすべてでこれを返す。文言・ステータスを分けると、攻撃者がその差分だけで
 * 「このメールは登録済みだ」と判別できてしまう（アカウント列挙）。
 */
const AUTH_FAILURE_MESSAGE = "メールアドレスまたはパスワードが違います";
const AUTH_FAILURE_STATUS = 401;

function authFailure(): Response {
  return errorResponse("AUTH_FAILED", AUTH_FAILURE_MESSAGE, AUTH_FAILURE_STATUS);
}

function invalidInput(): Response {
  return errorResponse("INVALID_INPUT", "入力が不正です", 400);
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

/** `Secure` は https のときだけ付ける。ローカル開発（http）で Cookie が落ちるのを防ぐ */
function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function sessionCookieHeader(request: Request, token: string): Record<string, string> {
  const maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;
  return {
    "set-cookie": buildSetCookie(SESSION_COOKIE, token, maxAgeSeconds, isSecureRequest(request)),
  };
}

function clearedSessionCookieHeader(request: Request): Record<string, string> {
  return { "set-cookie": buildSetCookie(SESSION_COOKIE, "", 0, isSecureRequest(request)) };
}

/** セッションを新規に張り、生トークンを返す（D1にはハッシュだけを保存する）。 */
async function issueSession(env: AppEnv, userId: string): Promise<string> {
  const token = newSessionToken();
  await createSession(env.DB, {
    tokenHash: await hashToken(token),
    userId,
    expiresAt: sessionExpiryIso(),
  });
  return token;
}

async function handleSignup(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return invalidInput();

  // クライアントの正規化を信用しない。サーバー側で必ず再正規化する
  const email = normalizeEmail(body.email);
  const keyInput = readClientKeyInput(body);
  if (!email || !keyInput) return invalidInput();

  const passwordHash = await hashClientKey(keyInput.key, keyInput.kdfVersion);
  const id = crypto.randomUUID();

  const created = await createUser(env.DB, { id, email, passwordHash });
  if (!created) {
    // メール重複。存在を明かさない — login失敗と同一の応答にする
    return authFailure();
  }

  const token = await issueSession(env, id);
  return json({ userId: id }, 200, sessionCookieHeader(request, token));
}

async function handleLogin(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return invalidInput();

  const email = normalizeEmail(body.email);
  const keyInput = readClientKeyInput(body);
  if (!email || !keyInput) return invalidInput();

  const user = await findUserByEmail(env.DB, email);
  if (!user) {
    // ユーザーが存在しない場合と鍵が違う場合で、文言・ステータスを変えない
    return authFailure();
  }

  const ok = await verifyClientKey(keyInput.key, user.passwordHash);
  if (!ok) return authFailure();

  const token = await issueSession(env, user.id);
  return json({ userId: user.id }, 200, sessionCookieHeader(request, token));
}

async function handleLogout(request: Request, env: AppEnv): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    try {
      await deleteSession(env.DB, await hashToken(token));
    } catch (err) {
      // DB削除に失敗してもログアウト自体は失敗させない。Cookieは必ず落とす
      console.error(err);
    }
  }
  return json({ ok: true }, 200, clearedSessionCookieHeader(request));
}

async function handleMe(request: Request, env: AppEnv): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return json({ userId: null });

  const userId = await findUserIdBySession(env.DB, await hashToken(token));
  return json({ userId });
}

type Handler = (request: Request, env: AppEnv) => Promise<Response>;

// `${method} ${path}` をキーにしたテーブルへ寄せる。各ハンドラの内側に
// メソッド判定を書くと、405 の処理がエンドポイント数だけ重複するため。
const ROUTES: Record<string, Handler> = {
  "POST /api/auth/signup": handleSignup,
  "POST /api/auth/login": handleLogin,
  "POST /api/auth/logout": handleLogout,
  "GET /api/auth/me": handleMe,
};

const KNOWN_PATHS = new Set(Object.keys(ROUTES).map((key) => key.split(" ", 2)[1]));

/**
 * `/api/auth/*` のディスパッチ。
 *
 * - パスもメソッドも一致 … 対応するハンドラを実行
 * - パスは一致するがメソッドが違う … 405（ここで一元的に決まる）
 * - パスがそもそも auth の既知パスでない … `null`（呼び出し側の 404 に委ねる）
 */
export async function handleAuthRoute(
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
