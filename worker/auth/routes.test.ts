import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../env";
import type { KvStore } from "../rateLimit";
import { hashToken } from "./session";
import { handleAuthRoute } from "./routes";

// 認証の中核4ハンドラ（signup / login / logout / me）の不変条件を固定する。
//
// env.DB は D1Database の本物ではなく、prepare/bind/first/run だけを返す
// 最小限のスタブ（FakeD1）にする。ここで守りたいのはハンドラの分岐であって
// SQL そのものではない（SQL は worker/db.ts が担当し、そちらはレビュー済み・
// 変更対象外）。FakeD1 は worker/db.ts が実際に発行する SQL 文の接頭辞で
// 分岐するので、worker/db.ts の実装が変わればここも意図的に壊れる。

const KEY = "a".repeat(43);
const OTHER_KEY = "b".repeat(43);
const KDF_VERSION = 1;

// routes.ts のプライベート定数と同じ値。routes.ts が非公開なのでここで複製する
// （変えるときはこちらも一緒に直す）。
const SIGNUP_IP_DAILY_LIMIT = 10;
const LOGIN_IP_DAILY_LIMIT = 30;

interface FakeUserRow {
  id: string;
  email: string;
  passwordHash: string;
}

interface FakeSessionRow {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

/** env.DB のスタブ。prepare().bind().run()/first() だけを実装する。 */
class FakeD1 {
  users: FakeUserRow[] = [];
  sessions: FakeSessionRow[] = [];
  /** true にすると DELETE FROM sessions が例外を投げる（logout の異常系用）。 */
  failDeleteSession = false;

  // すべてアロー関数にして `this` を素直にレキシカル束縛させる
  // （`this` を変数へ退避する alias パターンは避ける）。
  prepare = (sql: string) => {
    const run = async (...args: unknown[]) => {
      if (sql.startsWith("INSERT OR IGNORE INTO users")) {
        const [id, email, passwordHash] = args as [string, string, string, string];
        if (this.users.some((u) => u.email === email)) {
          return { meta: { changes: 0 } };
        }
        this.users.push({ id, email, passwordHash });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT INTO sessions")) {
        const [tokenHash, userId, expiresAt] = args as [string, string, string];
        this.sessions.push({ tokenHash, userId, expiresAt });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM sessions")) {
        if (this.failDeleteSession) throw new Error("db unavailable");
        const [tokenHash] = args as [string];
        this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
        return { meta: { changes: 1 } };
      }
      throw new Error(`FakeD1: unhandled run() for "${sql}"`);
    };

    const first = async <T,>(...args: unknown[]): Promise<T | null> => {
      if (sql.startsWith("SELECT id, password_hash FROM users")) {
        const [email] = args as [string];
        const user = this.users.find((u) => u.email === email);
        return user ? ({ id: user.id, password_hash: user.passwordHash } as T) : null;
      }
      if (sql.startsWith("SELECT user_id FROM sessions")) {
        const [tokenHash, now] = args as [string, string];
        const session = this.sessions.find(
          (s) => s.tokenHash === tokenHash && s.expiresAt > now,
        );
        return session ? ({ user_id: session.userId } as T) : null;
      }
      throw new Error(`FakeD1: unhandled first() for "${sql}"`);
    };

    return {
      bind: (...args: unknown[]) => ({
        run: () => run(...args),
        first: <T,>() => first<T>(...args),
      }),
    };
  };
}

/** env.RATE_LIMIT のスタブ。Map ベースの素朴な実装（worker/rateLimit.test.ts と同型）。 */
function fakeRateLimitKv(): KvStore {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function turnstileSiteverifyResponse(success: boolean): Response {
  return new Response(JSON.stringify({ success }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Turnstile 検証（worker/turnstile.ts）はグローバル fetch を叩く。routes.ts 側は
// fetchImpl を差し替えられないので、既定では「常に成功する」よう毎テスト前に
// グローバル fetch をスタブする。Turnstile 自体の失敗系を見たいテストだけ、
// その場で vi.stubGlobal を呼び直して上書きする。
//
// ⚠️ `mockResolvedValue` ではなく `mockImplementation` を使うこと。
// `Response` はボディを一度しか読めないため、同一の Response インスタンスを
// 使い回す `mockResolvedValue` だと、signup を複数回呼ぶテスト（重複メール・
// レート制限の連続呼び出しなど）で2回目以降の `res.json()` が
// 「ボディを読み尽くした」例外を投げ、Turnstile 検証が意図せず false になる。
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => turnstileSiteverifyResponse(true)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEnv(db: FakeD1, rateLimitKv: KvStore = fakeRateLimitKv()): AppEnv {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as AppEnv["ASSETS"],
    DB: db as unknown as AppEnv["DB"],
    MAIL_FROM: "ライフプランシミュレーター <noreply@nexeed-lab.com>",
    RESEND_API_KEY: "test-unused",
    RATE_LIMIT: rateLimitKv as unknown as AppEnv["RATE_LIMIT"],
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
  };
}

function req(
  method: string,
  url: string,
  opts: { body?: unknown; rawBody?: string; cookie?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["cf-connecting-ip"] = opts.ip;
  if (opts.body !== undefined || opts.rawBody !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new Request(url, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

/**
 * @param rateLimitKv 複数回の呼び出しでレート制限カウンタを積み上げたいときだけ、
 *   同じ KvStore を明示的に使い回す。省略時は呼び出しごとに新しい（空の）KVになる
 *   ので、通常の単発テストではレート制限が一切影響しない。
 */
async function call(request: Request, db: FakeD1, rateLimitKv?: KvStore): Promise<Response> {
  const env = makeEnv(db, rateLimitKv);
  const res = await handleAuthRoute(request, env, new URL(request.url));
  if (!res) throw new Error("handleAuthRoute returned null for a known auth path");
  return res;
}

function signupBody(email: string, key = KEY) {
  // turnstileToken: Turnstile 検証はテスト既定でグローバル fetch スタブにより
  // 常に成功する（beforeEach 参照）。文字列でさえあれば内容は何でもよい。
  return { email, key, kdfVersion: KDF_VERSION, turnstileToken: "valid-turnstile-token" };
}

/**
 * `res.json()` の中身を読む。
 *
 * ⚠️ @cloudflare/workers-types は `Response.json()` を `Promise<unknown>` に
 * 型づけている（dom lib の `Promise<any>` とは違う）ため、プロパティへ
 * 直接アクセスすると型検査で弾かれる。`JSON.parse` は常に `any` を返すので、
 * ここでだけ text() 経由で読み直して迂回する。
 */
async function errorCode(res: Response): Promise<string> {
  return JSON.parse(await res.text()).error.code;
}

describe("login: ユーザー不在と鍵違いは応答が完全に同一", () => {
  it("文言・ステータス・ヘッダとも一致する", async () => {
    const db = new FakeD1();
    // 実在するユーザーを1人作っておく（「鍵違い」ケース用）
    await call(req("POST", "https://lifeplan.example.com/api/auth/signup", { body: signupBody("exists@example.com") }), db);

    const notFound = await call(
      req("POST", "https://lifeplan.example.com/api/auth/login", {
        body: { email: "nobody@example.com", key: KEY, kdfVersion: KDF_VERSION },
      }),
      db,
    );
    const wrongKey = await call(
      req("POST", "https://lifeplan.example.com/api/auth/login", {
        body: { email: "exists@example.com", key: OTHER_KEY, kdfVersion: KDF_VERSION },
      }),
      db,
    );

    expect(notFound.status).toBe(401);
    expect(notFound.status).toBe(wrongKey.status);
    expect(await notFound.text()).toBe(await wrongKey.text());
    expect(notFound.headers.get("content-type")).toBe(wrongKey.headers.get("content-type"));
    expect(notFound.headers.get("cache-control")).toBe(wrongKey.headers.get("cache-control"));
    // どちらの失敗でもセッションは張られない
    expect(notFound.headers.get("set-cookie")).toBeNull();
    expect(wrongKey.headers.get("set-cookie")).toBeNull();
  });
});

describe("signup: メール重複時はセッションを張らない", () => {
  it("createUser が false を返すとき Set-Cookie を出さず、EMAIL_TAKEN を返す", async () => {
    const db = new FakeD1();
    const first = await call(
      req("POST", "https://lifeplan.example.com/api/auth/signup", {
        body: signupBody("dup@example.com"),
      }),
      db,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).not.toBeNull();
    const sessionsAfterFirst = db.sessions.length;

    const second = await call(
      req("POST", "https://lifeplan.example.com/api/auth/signup", {
        body: signupBody("dup@example.com"),
      }),
      db,
    );

    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("EMAIL_TAKEN");
    expect(second.headers.get("set-cookie")).toBeNull();
    // 重複時にセッションが追加で張られていない
    expect(db.sessions.length).toBe(sessionsAfterFirst);
  });
});

describe("me: 期限切れセッションは userId: null（M-4: Cookie も落とす）", () => {
  it("期限切れなら userId: null を返す", async () => {
    const db = new FakeD1();
    const token = "expired-token-value";
    const tokenHash = await hashToken(token);
    db.sessions.push({
      tokenHash,
      userId: "some-user-id",
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // 1分前に失効
    });

    const res = await call(
      req("GET", "https://lifeplan.example.com/api/auth/me", { cookie: `lp_session=${token}` }),
      db,
    );

    expect(await res.json()).toEqual({ userId: null });
  });

  it("期限切れセッションの Cookie は Max-Age=0 で落とす（M-4）", async () => {
    const db = new FakeD1();
    const token = "expired-token-value-2";
    const tokenHash = await hashToken(token);
    db.sessions.push({
      tokenHash,
      userId: "some-user-id",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await call(
      req("GET", "https://lifeplan.example.com/api/auth/me", { cookie: `lp_session=${token}` }),
      db,
    );

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("Cookie 自体が無ければ落とすものが無い（Set-Cookie を出さない）", async () => {
    const db = new FakeD1();
    const res = await call(req("GET", "https://lifeplan.example.com/api/auth/me"), db);
    expect(await res.json()).toEqual({ userId: null });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("logout: DB削除に失敗してもCookieは必ず落とす", () => {
  it("deleteSession が例外を投げても 200 + Set-Cookie(Max-Age=0) を返す", async () => {
    const db = new FakeD1();
    const token = "some-session-token";
    const tokenHash = await hashToken(token);
    db.sessions.push({
      tokenHash,
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    db.failDeleteSession = true;

    const res = await call(
      req("POST", "https://lifeplan.example.com/api/auth/logout", {
        cookie: `lp_session=${token}`,
      }),
      db,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("不正な入力で例外が漏れない", () => {
  it("壊れたJSON本文でも例外を投げず 400 を返す", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", "https://lifeplan.example.com/api/auth/signup", { rawBody: "{not json" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_INPUT");
  });

  it("フィールドが欠けていても例外を投げず 400 を返す", async () => {
    const db = new FakeD1();
    const res = await call(
      // turnstileToken だけは入れておく（無いと Turnstile 検証の403が先に返り、
      // このテストが確かめたい「email/key欠如→400」を検証できなくなるため）
      req("POST", "https://lifeplan.example.com/api/auth/signup", {
        body: { turnstileToken: "valid-turnstile-token" },
      }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_INPUT");
  });

  it("JSON配列など、オブジェクトでない本文でも 400 を返す", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", "https://lifeplan.example.com/api/auth/login", { body: [1, 2, 3] }),
      db,
    );
    expect(res.status).toBe(400);
  });
});

describe("全応答に cache-control: no-store が付く", () => {
  it("signup 成功・signup 重複・login 失敗・logout・me のいずれも no-store", async () => {
    const db = new FakeD1();
    const responses: Response[] = [];

    responses.push(
      await call(
        req("POST", "https://lifeplan.example.com/api/auth/signup", {
          body: signupBody("cache@example.com"),
        }),
        db,
      ),
    );
    responses.push(
      await call(
        req("POST", "https://lifeplan.example.com/api/auth/signup", {
          body: signupBody("cache@example.com"),
        }),
        db,
      ),
    );
    responses.push(
      await call(
        req("POST", "https://lifeplan.example.com/api/auth/login", {
          body: { email: "nobody@example.com", key: KEY, kdfVersion: KDF_VERSION },
        }),
        db,
      ),
    );
    responses.push(
      await call(req("POST", "https://lifeplan.example.com/api/auth/logout"), db),
    );
    responses.push(await call(req("GET", "https://lifeplan.example.com/api/auth/me"), db));

    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});

describe("Secure 属性はホスト名で決まる（I-1 の再発防止）", () => {
  it("http://localhost では Secure を付けない", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", "http://localhost:8787/api/auth/signup", { body: signupBody("local@example.com") }),
      db,
    );
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("http://127.0.0.1 でも Secure を付けない", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", "http://127.0.0.1:8787/api/auth/signup", { body: signupBody("loop@example.com") }),
      db,
    );
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("スキームが http でも、localhost 以外のホストなら Secure を付ける（I-1 の核心）", async () => {
    // 旧実装は new URL(request.url).protocol === "https:" で判定していたため、
    // 本番ドメインに http で着地するとここが「付けない」に倒れ、Cookie が
    // 平文で流れる穴になっていた。ホスト名判定に直した今は、スキームに
    // かかわらず localhost 系以外なら常に Secure を付ける。
    const db = new FakeD1();
    const res = await call(
      req("POST", "http://lifeplan.nexeed-lab.com/api/auth/signup", {
        body: signupBody("prod-http@example.com"),
      }),
      db,
    );
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("https の本番ドメインでも当然 Secure を付ける", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", "https://lifeplan.nexeed-lab.com/api/auth/signup", {
        body: signupBody("prod-https@example.com"),
      }),
      db,
    );
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });
});

describe("signup: Turnstile 検証（D1に触る前に行う）", () => {
  it("Turnstile 検証に失敗したら 403 になり、users に行が増えない", async () => {
    const db = new FakeD1();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(turnstileSiteverifyResponse(false)));

    const res = await call(
      req("POST", "https://lifeplan.example.com/api/auth/signup", {
        body: signupBody("blocked-by-turnstile@example.com"),
      }),
      db,
    );

    expect(res.status).toBe(403);
    expect(db.users).toHaveLength(0);
  });

  it("turnstileToken が無ければ fetch を呼ばずに 403 になり、users に行が増えない", async () => {
    const db = new FakeD1();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const res = await call(
      req("POST", "https://lifeplan.example.com/api/auth/signup", {
        body: { email: "no-token@example.com", key: KEY, kdfVersion: KDF_VERSION },
      }),
      db,
    );

    expect(res.status).toBe(403);
    expect(db.users).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("signup: IP別レート制限（1日10回まで）", () => {
  it("同一IPから11回目は 429 / RATE_LIMITED になる", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();
    let last: Response | undefined;

    for (let i = 0; i < SIGNUP_IP_DAILY_LIMIT + 1; i++) {
      last = await call(
        req("POST", "https://lifeplan.example.com/api/auth/signup", {
          body: signupBody(`rl-signup-${i}@example.com`),
          ip: "203.0.113.10",
        }),
        db,
        kv,
      );
    }

    expect(last!.status).toBe(429);
    expect(await errorCode(last!)).toBe("RATE_LIMITED");
    // 10回目までは通っているはず（11回目だけが拒否）
    expect(db.users).toHaveLength(SIGNUP_IP_DAILY_LIMIT);
  });

  it("レート制限の応答に理由が含まれない（メッセージにIPや上限といった語を出さない）", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();
    let last: Response | undefined;

    for (let i = 0; i < SIGNUP_IP_DAILY_LIMIT + 1; i++) {
      last = await call(
        req("POST", "https://lifeplan.example.com/api/auth/signup", {
          body: signupBody(`rl-reason-${i}@example.com`),
          ip: "203.0.113.11",
        }),
        db,
        kv,
      );
    }

    const body = JSON.parse(await last!.text());
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).not.toMatch(/IP|アドレス|上限|回数/);
  });

  it("cf-connecting-ip が無いときは何回呼んでも制限がかからない（ローカル開発対応）", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();

    for (let i = 0; i < SIGNUP_IP_DAILY_LIMIT + 1; i++) {
      const res = await call(
        req("POST", "https://lifeplan.example.com/api/auth/signup", {
          body: signupBody(`no-ip-${i}@example.com`),
        }),
        db,
        kv,
      );
      expect(res.status).not.toBe(429);
    }
  });
});

describe("login: IP別レート制限（1日30回まで）", () => {
  it("同一IPから31回目は 429 / RATE_LIMITED になる", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();
    let last: Response | undefined;

    for (let i = 0; i < LOGIN_IP_DAILY_LIMIT + 1; i++) {
      last = await call(
        req("POST", "https://lifeplan.example.com/api/auth/login", {
          body: { email: "nobody@example.com", key: KEY, kdfVersion: KDF_VERSION },
          ip: "198.51.100.20",
        }),
        db,
        kv,
      );
    }

    expect(last!.status).toBe(429);
    expect(await errorCode(last!)).toBe("RATE_LIMITED");
  });

  it("cf-connecting-ip が無いときは何回呼んでも制限がかからない（ローカル開発対応）", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();

    for (let i = 0; i < LOGIN_IP_DAILY_LIMIT + 1; i++) {
      const res = await call(
        req("POST", "https://lifeplan.example.com/api/auth/login", {
          body: { email: "nobody@example.com", key: KEY, kdfVersion: KDF_VERSION },
        }),
        db,
        kv,
      );
      expect(res.status).not.toBe(429);
    }
  });
});
