// 認証APIを叩くブラウザ側クライアント。
//
// ⚠️ パスワード本体は絶対にサーバーへ送らない。deriveClientKey(email, password)
// （src/lib/auth/kdf.ts）で鍵に変えてから送る。これがこの設計の核心で、
// テスト（client.test.ts）が送信ボディに `password` が無いことを固定している。
//
// ⚠️ `credentials: "same-origin"` を必ず付ける。付けないとログイン/ログアウトの
// Set-Cookie / Cookie 送受信が成立しない。
//
// ⚠️ サーバーのエラー文言（message）はそのまま返す。ここで言い換えると、
// login失敗（ユーザー不在 / 鍵違いで文言・ステータスを完全に揃えてある。
// worker/auth/routes.ts の AUTH_FAILURE_MESSAGE 参照）で崩れる。
//
// ⚠️ `fetchImpl` 引数で fetch を差し替えられるようにしてある。テストが
// 実際に通信しないようにするため。既定値はブラウザのグローバル `fetch`。

import { deriveClientKey, KDF_VERSION } from "./kdf";

export type AuthResult = { ok: true } | { ok: false; code: string; message: string };

/** `errorResponse`（worker/http.ts）が返す本文の形。 */
interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

// fetch 自体が失敗した（オフライン・DNS失敗など、サーバーから応答が
// 返ってきていない）ときだけ使う。サーバーが返したエラーではないので、
// code・message はサーバー由来のものと混同しないようここで決める。
const NETWORK_ERROR_CODE = "NETWORK_ERROR";
const NETWORK_ERROR_MESSAGE =
  "通信に失敗しました。ネットワークの状態を確認してからもう一度お試しください";

interface FetchOutcome {
  status: number;
  body: unknown;
}

/**
 * `fetchImpl` を呼び、応答を { status, body } に正規化する。
 *
 * ⚠️ ここで例外を外に投げない。呼び出し側（signup/login/...）がネットワーク
 * エラーで例外を投げないことをテストで固定しているため（画面が落ちるより
 * エラー表示のほうが良い、というブリーフの方針）。fetch自体の失敗も、
 * 応答のJSONが壊れている場合も、ここで吸収して `null` を返す。
 */
async function safeFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<FetchOutcome | null> {
  try {
    const res = await fetchImpl(input, { ...init, credentials: "same-origin" });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/**
 * サーバーの応答を AuthResult に変換する。
 *
 * ⚠️ message はサーバーの文言をそのまま使う（言い換えない）。
 */
function toAuthResult(outcome: FetchOutcome): AuthResult {
  if (outcome.status >= 200 && outcome.status < 300) return { ok: true };
  const error = (outcome.body as ErrorBody | null)?.error;
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR";
  const message = typeof error?.message === "string" ? error.message : "エラーが発生しました";
  return { ok: false, code, message };
}

const NETWORK_ERROR_RESULT: AuthResult = {
  ok: false,
  code: NETWORK_ERROR_CODE,
  message: NETWORK_ERROR_MESSAGE,
};

const JSON_HEADERS: Record<string, string> = { "content-type": "application/json" };

/**
 * 新規登録。鍵導出は重い（PBKDF2 60万回で0.2〜0.6秒）ので、呼び出し側が
 * ローディング表示を出せるよう、ここでは Promise を返すだけにする。
 */
export async function signup(
  input: { email: string; password: string; turnstileToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  const key = await deriveClientKey(input.email, input.password);
  const outcome = await safeFetch(fetchImpl, "/api/auth/signup", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email: input.email,
      key,
      kdfVersion: KDF_VERSION,
      turnstileToken: input.turnstileToken,
    }),
  });
  if (!outcome) return NETWORK_ERROR_RESULT;
  return toAuthResult(outcome);
}

/** ログイン。鍵導出は signup と同じく重いので Promise を返すだけにする。 */
export async function login(
  input: { email: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  const key = await deriveClientKey(input.email, input.password);
  const outcome = await safeFetch(fetchImpl, "/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: input.email, key, kdfVersion: KDF_VERSION }),
  });
  if (!outcome) return NETWORK_ERROR_RESULT;
  return toAuthResult(outcome);
}

/**
 * ログアウト。サーバーは常に 200 を返す設計（worker/auth/routes.ts の
 * handleLogout）なので、失敗を表現する必要が無く戻り値は void。
 * ネットワークエラーでも例外は投げない（黙って諦めてよい操作のため）。
 */
export async function logout(fetchImpl: typeof fetch = fetch): Promise<void> {
  await safeFetch(fetchImpl, "/api/auth/logout", { method: "POST" });
}

/**
 * ログイン状態を問い合わせる。`GET /api/auth/me` は常に `{ userId }` を
 * 返す設計（未ログインなら null）なので、失敗もネットワークエラーも
 * 同じ「わからない＝null」として扱う。
 */
export async function fetchMe(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const outcome = await safeFetch(fetchImpl, "/api/auth/me", { method: "GET" });
  if (!outcome) return null;
  const body = outcome.body as { userId?: unknown } | null;
  return typeof body?.userId === "string" ? body.userId : null;
}

/**
 * パスワード再設定メールの送信依頼。
 *
 * ⚠️ サーバーは常に `200 { ok: true }` を返す設計（登録済みかどうかを
 * 応答から判別できないようにするため。worker/auth/reset.ts）。
 * だからここも戻り値を void にする — 「失敗」を表現する分岐を作らない。
 */
export async function requestPasswordReset(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await safeFetch(fetchImpl, "/api/auth/forgot-password", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email }),
  });
}

/**
 * 再設定トークンに紐づくメールアドレスを引く。鍵導出にメールが要るため
 * （下の resetPassword のコメント参照）。
 *
 * トークンは256bitの秘密で、メールの受信者しか持たない。その持ち主に
 * そのメールアドレス自身を返すことは新たな開示にならない
 * （`GET /api/auth/reset-token?token=...`、トークンを消費しない照会）。
 *
 * 無効・期限切れ・使用済み・ネットワークエラーのいずれも区別せず null。
 */
export async function fetchResetTokenEmail(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const outcome = await safeFetch(
    fetchImpl,
    `/api/auth/reset-token?token=${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (!outcome || outcome.status < 200 || outcome.status >= 300) return null;
  const body = outcome.body as { email?: unknown } | null;
  return typeof body?.email === "string" ? body.email : null;
}

/**
 * パスワードを再設定する。
 *
 * ⚠️ email が必須なのは、鍵導出のソルトがメールアドレス由来だから
 * （src/lib/auth/kdf.ts の saltFor）。ここで渡すメールは画面の入力ではなく、
 * fetchResetTokenEmail でサーバーから引いた値を使うこと。
 * 利用者に入力させると、打ち間違えたときに「再設定は成功したのに
 * ログインできない」という原因の分からない状態になる
 * （このズレは resetPassword 自体は成功するのでその場では気付けず、
 * 次回ログイン時に初めて表面化する）。
 *
 * サーバーへ送るボディに email は含めない。サーバーは token だけで
 * 本人確認する（worker/auth/reset.ts の handleResetPassword）ので不要
 * — 送る必要が無いものは送らない。
 */
export async function resetPassword(
  input: { token: string; email: string; password: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  const key = await deriveClientKey(input.email, input.password);
  const outcome = await safeFetch(fetchImpl, "/api/auth/reset-password", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: input.token, key, kdfVersion: KDF_VERSION }),
  });
  if (!outcome) return NETWORK_ERROR_RESULT;
  return toAuthResult(outcome);
}
