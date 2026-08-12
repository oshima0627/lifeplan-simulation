// 認証APIのルートハンドラ（signup / login / logout / me）。
//
// すべての応答はここから http.ts の json / errorResponse を通して返す
// （cache-control の付け忘れを防ぐという http.ts の不変条件を守るため）。

import { normalizeEmail } from "../../shared/auth/email";
import { buildSetCookie, readCookie, SESSION_COOKIE } from "../cookies";
import { createSession, createUser, deleteSession, findUserByEmail, findUserIdBySession } from "../db";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import { checkAndBump, hashForKey, todayUtc } from "../rateLimit";
import { verifyTurnstile } from "../turnstile";
import { hashClientKey, readClientKeyInput, verifyClientKey } from "./password";
import { hashToken, newSessionToken, sessionExpiryIso, SESSION_TTL_DAYS } from "./session";

// IP別・1日あたりの上限（設計書 §5.4 の考え方に合わせる）
const SIGNUP_IP_DAILY_LIMIT = 10;
const LOGIN_IP_DAILY_LIMIT = 30;

// メールアドレス別・1日あたりの login 失敗上限（I-3）。
//
// IP別の上限だけでは、IPv6 の /64 が1契約に払い出される環境（I-2参照）と
// 組み合わさると「特定アカウントへの総当たり」を防げない
// （IP側の上限は同一 /64 内の無数のアドレスを渡り歩けば無限に回避できる）。
// forgot-password の FORGOT_PASSWORD_EMAIL_DAILY_LIMIT と同じ考え方で、
// アカウント単位でも頭打ちにする。
const LOGIN_EMAIL_DAILY_LIMIT = 20;

/**
 * login の失敗文言。「ユーザーが存在しない」場合と「鍵が違う」場合とで
 * 文言・ステータスを変えない（この2ケースの区別がつくと、既存アカウントの
 * メールアドレスをログイン画面から列挙できてしまう）。
 *
 * ⚠️ signup の重複メールはこれとは**別扱い**（EMAIL_TAKEN、下記）。
 * signup 中の利用者は「登録しようとしている」のであってパスワードを
 * 間違えたわけではないため、ここに合流させると次に進む手段が無くなる
 * （ログインすべきかも分からない）。signup 重複だけを専用文言にすると
 * 「このメールは登録済みか」を試せる窓口にはなるが、そのトレードオフは
 * 正当な利用者のUX破綻より小さいと判断し許容する（列挙対策は文言統一では
 * なくレート制限 — A-3 で Turnstile とともに導入）。
 */
const AUTH_FAILURE_MESSAGE = "メールアドレスまたはパスワードが違います";
const AUTH_FAILURE_STATUS = 401;

function authFailure(): Response {
  return errorResponse("AUTH_FAILED", AUTH_FAILURE_MESSAGE, AUTH_FAILURE_STATUS);
}

/** signup でメールが重複したときだけの専用応答。login の失敗とは文言・ステータスを分ける。 */
function emailTaken(): Response {
  return errorResponse(
    "EMAIL_TAKEN",
    "このメールアドレスはすでに登録されています。ログインをお試しください。",
    409,
  );
}

function invalidInput(): Response {
  return errorResponse("INVALID_INPUT", "入力が不正です", 400);
}

/** Turnstile 検証に失敗したときの応答。`users` に行を作る前に返す（D1に触らない）。 */
function turnstileFailure(): Response {
  return errorResponse(
    "TURNSTILE_FAILED",
    "確認に失敗しました。ページを再読み込みしてからもう一度お試しください",
    403,
  );
}

/**
 * レート制限に引っかかったときの応答。
 *
 * ⚠️ コードも文言もこの1本に統一する。「IPの上限に達した」のか他の理由なのかを
 * 応答から判別できるようにしてしまうと、攻撃者に制限の仕組みそのものを
 * 教えることになる。
 */
function rateLimited(): Response {
  return errorResponse("RATE_LIMITED", "しばらく時間をおいてから再度お試しください", 429);
}

/**
 * レート制限のキーに使う識別子へ丸める。
 *
 * ⚠️ IPv6 をフルアドレスのまま使ってはいけない。クラウドやVPSでは /64 が
 * 1契約に払い出されるのが普通で、その中の 2^64 個を使い回されると
 * IP別の上限が丸ごと無効になる。/64 に丸めれば1契約=1カウンタになる。
 *
 * IPv4 はそのまま使う（/32 が個別に割り当てられるため）。
 */
function toRateLimitIdentity(ip: string): string {
  if (!ip.includes(":")) return ip;
  // IPv6。先頭4グループ（64ビット）だけを使う。
  // "::" の省略記法があるため、展開せずに素朴に切ると誤るケースがある点に注意
  return expandIPv6Groups(ip).slice(0, 4).join(":");
}

/**
 * IPv6アドレスを8グループの16進文字列配列へ展開する。
 *
 * "::" はアドレス中に最大1回だけ現れる「0で埋めた連続グループ」の省略記法。
 * "::" の前後（head/tail）それぞれのグループ数を数え、8個に足りない分を
 * "0" で埋めて間に差し込むことで正しく復元する（`split(":")` を素朴に
 * 先頭4個切るだけだと、"2001:db8::1" のような短縮形で "::" の位置を
 * 読み違えて誤ったグループに切り分けてしまう）。
 *
 * 各グループは 16進数として解釈し直してから文字列化し、大文字・先頭ゼロの
 * 表記ゆれ（"0DB8" と "db8" など）を吸収する。ゾーンID（"%eth0" など）は
 * 無視する。IPv4混在表記（"::ffff:192.0.2.1" 等）や壊れた入力は正しく
 * 展開できないため、安全側に倒して元の文字列をそのまま1グループとして返す
 * （＝レート制限が過剰にはならず、そのアドレスだけの個別バケツになるだけ）。
 */
function expandIPv6Groups(ip: string): string[] {
  const addr = ip.split("%")[0] ?? ip;
  if (addr.includes(".")) return [addr]; // IPv4混在表記は非対応、安全側にフォールバック

  const parts = addr.split("::");
  if (parts.length > 2) return [addr]; // "::" が2回以上 = 壊れた入力

  let groups: string[];
  if (parts.length === 2) {
    const head = parts[0] ? parts[0].split(":") : [];
    const tail = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return [addr]; // 壊れた入力
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = addr.split(":");
  }
  if (groups.length !== 8) return [addr]; // 壊れた入力

  return groups.map((g) => {
    const n = Number.parseInt(g, 16);
    return Number.isFinite(n) ? n.toString(16) : g;
  });
}

/**
 * IP別の日次レート制限を確認し、カウンタを進める。許可なら true。
 *
 * ⚠️ `cf-connecting-ip` が取れない場合は制限をかけない（常に true）。
 * 本番では Cloudflare がリクエストへ必ずこのヘッダーを付与するため、
 * 取れないのは `wrangler dev` などのローカル開発時だけ。ここで一律に
 * 弾いてしまうとローカル開発そのものができなくなるため、意図的に許可側へ倒す。
 */
export async function checkIpRateLimit(
  env: AppEnv,
  ip: string | null,
  scope: string,
  limit: number,
): Promise<boolean> {
  if (!ip) return true;
  const key = `rl:${scope}:${todayUtc()}:${await hashForKey(toRateLimitIdentity(ip))}`;
  return checkAndBump(env.RATE_LIMIT, key, limit);
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

/**
 * `Secure` 属性を付けるか。
 *
 * ⚠️ リクエストのスキームで判定してはいけない。Workers には http:// の
 * リクエストもそのまま届くため（Cloudflare 側で Always Use HTTPS を有効に
 * しない限り）、http で着地したままログインすると Secure 無しの Cookie が
 * 発行され、以降トークンが平文で流れる。
 *
 * ローカル開発（http://localhost 等）でだけ外し、それ以外は常に付ける。
 */
function shouldSecureCookie(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
}

function sessionCookieHeader(request: Request, token: string): Record<string, string> {
  const maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;
  return {
    "set-cookie": buildSetCookie(SESSION_COOKIE, token, maxAgeSeconds, shouldSecureCookie(request)),
  };
}

function clearedSessionCookieHeader(request: Request): Record<string, string> {
  return { "set-cookie": buildSetCookie(SESSION_COOKIE, "", 0, shouldSecureCookie(request)) };
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

  const ip = request.headers.get("cf-connecting-ip");

  // Turnstile の検証は D1 に触る前に行う。後にすると、検証を通らない
  // リクエストでも（メール重複チェックなどの）DB負荷をかけられてしまう。
  const turnstileOk = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY, ip ?? undefined);
  if (!turnstileOk) return turnstileFailure();

  // 入力検証（純粋なCPU処理。DBにも外部にも触らない）はレート制限より前に置く（M-2）。
  // 逆にすると、正当な利用者が入力ミスをしただけで10回/日の枠を1つ失ってしまう。
  // Turnstile の後ろにある限り、無料の入力検証オラクルとして乱打される心配もない。
  //
  // クライアントの正規化を信用しない。サーバー側で必ず再正規化する
  const email = normalizeEmail(body.email);
  const keyInput = readClientKeyInput(body);
  if (!email || !keyInput) return invalidInput();

  if (!(await checkIpRateLimit(env, ip, "signup", SIGNUP_IP_DAILY_LIMIT))) return rateLimited();

  const passwordHash = await hashClientKey(keyInput.key, keyInput.kdfVersion);
  const id = crypto.randomUUID();

  const created = await createUser(env.DB, { id, email, passwordHash });
  if (!created) {
    // メール重複。専用の文言・ステータスで案内する（login失敗とは分ける）
    return emailTaken();
  }

  const token = await issueSession(env, id);
  return json({ userId: id }, 200, sessionCookieHeader(request, token));
}

async function handleLogin(request: Request, env: AppEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return invalidInput();

  const ip = request.headers.get("cf-connecting-ip");
  if (!(await checkIpRateLimit(env, ip, "login", LOGIN_IP_DAILY_LIMIT))) return rateLimited();

  const email = normalizeEmail(body.email);
  const keyInput = readClientKeyInput(body);
  if (!email || !keyInput) return invalidInput();

  // メールアドレス別の日次上限（I-3）。IP別（LOGIN_IP_DAILY_LIMIT）だけでは、
  // IPv6の/64が1契約に払い出される環境で同一/64内のアドレスを渡り歩かれると
  // 特定アカウントへの試行が無制限になる（I-2参照）。
  //
  // ⚠️ ユーザーが存在するかどうかを見る前に必ず消費すること。存在確認の後に
  // 置くと「枠が減ったかどうか」からアカウントの実在が漏れる
  // （forgot-password の考え方と同じ。上のコメント・reset.ts 参照）。
  const loginEmailRateLimitKey = `rl:login-email:${todayUtc()}:${await hashForKey(email)}`;
  if (!(await checkAndBump(env.RATE_LIMIT, loginEmailRateLimitKey, LOGIN_EMAIL_DAILY_LIMIT))) {
    return rateLimited();
  }

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
  if (userId === null) {
    // トークンはあったが無効（期限切れ／存在しない）。無効なトークンを
    // ブラウザに残し続けない。logout と同じ仕組みで Cookie を落とす（M-4）
    return json({ userId: null }, 200, clearedSessionCookieHeader(request));
  }
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
