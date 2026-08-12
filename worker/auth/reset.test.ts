import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../env";
import { hashForKey, todayUtc, type KvStore } from "../rateLimit";
import { handleResetRoute, RESET_TOKEN_TTL_MINUTES } from "./reset";
import { hashToken } from "./session";

// worker/auth/routes.test.ts の FakeD1 と同じ考え方: prepare/bind/run/first
// だけを実装した最小スタブ。worker/db.ts が発行する SQL 文の接頭辞で分岐する。

const KEY = "a".repeat(43);
const KDF_VERSION = 1;
const FORGOT_PASSWORD_EMAIL_DAILY_LIMIT = 5; // reset.ts のプライベート定数と同値（非公開なのでここで複製）

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

interface FakeResetRow {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

class FakeD1 {
  users: FakeUserRow[] = [];
  sessions: FakeSessionRow[] = [];
  resets: FakeResetRow[] = [];

  prepare = (sql: string) => {
    const run = async (...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO password_resets")) {
        const [tokenHash, userId, expiresAt] = args as [string, string, string];
        this.resets.push({ tokenHash, userId, expiresAt, usedAt: null });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE password_resets SET used_at")) {
        const [usedAt, tokenHash, nowIso] = args as [string, string, string];
        const row = this.resets.find(
          (r) => r.tokenHash === tokenHash && r.usedAt === null && r.expiresAt > nowIso,
        );
        if (!row) return { meta: { changes: 0 } };
        row.usedAt = usedAt;
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE users SET password_hash")) {
        const [passwordHash, userId] = args as [string, string];
        const user = this.users.find((u) => u.id === userId);
        if (!user) return { meta: { changes: 0 } };
        user.passwordHash = passwordHash;
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM sessions WHERE user_id")) {
        const [userId] = args as [string];
        const before = this.sessions.length;
        this.sessions = this.sessions.filter((s) => s.userId !== userId);
        return { meta: { changes: before - this.sessions.length } };
      }
      throw new Error(`FakeD1: unhandled run() for "${sql}"`);
    };

    const first = async <T,>(...args: unknown[]): Promise<T | null> => {
      if (sql.startsWith("SELECT id, password_hash FROM users")) {
        const [email] = args as [string];
        const user = this.users.find((u) => u.email === email);
        return user ? ({ id: user.id, password_hash: user.passwordHash } as T) : null;
      }
      if (sql.startsWith("SELECT user_id FROM password_resets")) {
        const [tokenHash] = args as [string];
        const row = this.resets.find((r) => r.tokenHash === tokenHash);
        return row ? ({ user_id: row.userId } as T) : null;
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

function resendSuccessResponse(): Response {
  return new Response(JSON.stringify({ id: "mail-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// sendPasswordResetMail はグローバル fetch を叩く（reset.ts は fetchImpl を
// 差し替えない）。既定では常に成功させ、失敗系だけその場で上書きする。
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resendSuccessResponse()));
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
    TURNSTILE_SECRET_KEY: "test-unused",
  };
}

function req(
  method: string,
  url: string,
  opts: { body?: unknown; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined || opts.rawBody !== undefined) {
    headers["content-type"] = "application/json";
  }
  return new Request(url, {
    method,
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

async function call(request: Request, db: FakeD1, rateLimitKv?: KvStore): Promise<Response> {
  const env = makeEnv(db, rateLimitKv);
  const res = await handleResetRoute(request, env, new URL(request.url));
  if (!res) throw new Error("handleResetRoute returned null for a known reset path");
  return res;
}

async function errorCode(res: Response): Promise<string> {
  return JSON.parse(await res.text()).error.code;
}

const FORGOT_URL = "https://lifeplan.example.com/api/auth/forgot-password";
const RESET_URL = "https://lifeplan.example.com/api/auth/reset-password";

describe("forgot-password: 応答は常に 200 { ok: true }", () => {
  it("未登録アドレスでも登録済みアドレスでも応答が完全に同一", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });

    const unknown = await call(req("POST", FORGOT_URL, { body: { email: "nobody@example.com" } }), db);
    const known = await call(req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }), db);

    expect(unknown.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    const unknownText = await unknown.text();
    const knownText = await known.text();
    expect(unknownText).toBe(knownText);
    expect(JSON.parse(knownText)).toEqual({ ok: true });
  });

  it("メール形式が不正でも 200 { ok: true }", async () => {
    const db = new FakeD1();
    const res = await call(req("POST", FORGOT_URL, { body: { email: "not-an-email" } }), db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("壊れたJSON本文でも 200 { ok: true }", async () => {
    const db = new FakeD1();
    const res = await call(req("POST", FORGOT_URL, { rawBody: "{not json" }), db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("forgot-password: 登録済みアドレスだけトークンを発行しメールを送る", () => {
  it("未登録アドレスでは password_resets に行が増えず、メールも送られない", async () => {
    const db = new FakeD1();
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);

    await call(req("POST", FORGOT_URL, { body: { email: "nobody@example.com" } }), db);

    expect(db.resets).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("登録済みアドレスでは password_resets に行が増え、Resend へ送信される", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);

    await call(req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }), db);

    expect(db.resets).toHaveLength(1);
    expect(db.resets[0]?.userId).toBe("user-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.resend.com/emails");
  });

  it("メール送信に失敗しても 200 { ok: true } のまま（例外を投げない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "boom" }), { status: 500 })),
    );

    const res = await call(req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }), db);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // トークン自体は既に発行済み（メール送信の失敗とは独立）
    expect(db.resets).toHaveLength(1);
  });
});

describe("forgot-password: レート制限はアドレスの有無に関わらず消費する", () => {
  it("未登録アドレスへの1回目の呼び出しでもKVの枠が消費される", async () => {
    const db = new FakeD1();
    const kv = fakeRateLimitKv();
    const email = "nobody-rl@example.com";

    await call(req("POST", FORGOT_URL, { body: { email } }), db, kv);

    const key = `rl:forgot-password:${todayUtc()}:${await hashForKey(email)}`;
    expect(await kv.get(key)).toBe("1");
  });

  it("登録済みアドレスが上限を超えると、それ以降はトークンもメールも発行しない（応答は変えない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "limited@example.com", passwordHash: "irrelevant" });
    const kv = fakeRateLimitKv();
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);

    for (let i = 0; i < FORGOT_PASSWORD_EMAIL_DAILY_LIMIT + 1; i++) {
      const res = await call(req("POST", FORGOT_URL, { body: { email: "limited@example.com" } }), db, kv);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }

    expect(db.resets).toHaveLength(FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);
    expect(fetchImpl).toHaveBeenCalledTimes(FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);
  });
});

describe("reset-password: トークンの消費と全セッション削除", () => {
  async function seedValidReset(db: FakeD1, userId: string, token: string): Promise<void> {
    db.resets.push({
      tokenHash: await hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
      usedAt: null,
    });
  }

  it("有効なトークンで新しい鍵を保存し、200 { ok: true } を返す", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "old-hash" });
    const token = "valid-reset-token";
    await seedValidReset(db, "user-1", token);

    const res = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.users[0]?.passwordHash).not.toBe("old-hash");
  });

  it("再設定後にログイン中のセッションを自動発行しない（Set-Cookie を出さない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "old-hash" });
    const token = "no-autologin-token";
    await seedValidReset(db, "user-1", token);

    const res = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );

    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("成功したら、そのユーザーの全セッションを削除する（他ユーザーは残す）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "victim@example.com", passwordHash: "old-hash" });
    db.sessions.push(
      { tokenHash: "s1", userId: "user-1", expiresAt: "2999-01-01T00:00:00.000Z" },
      { tokenHash: "s2", userId: "user-1", expiresAt: "2999-01-01T00:00:00.000Z" },
      { tokenHash: "s3", userId: "other-user", expiresAt: "2999-01-01T00:00:00.000Z" },
    );
    const token = "revoke-sessions-token";
    await seedValidReset(db, "user-1", token);

    await call(req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }), db);

    expect(db.sessions.map((s) => s.tokenHash)).toEqual(["s3"]);
  });

  it("同じトークンは2回目に使えない（RESET_TOKEN_INVALID）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "old-hash" });
    const token = "reused-token";
    await seedValidReset(db, "user-1", token);

    const first = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );
    const second = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(await errorCode(second)).toBe("RESET_TOKEN_INVALID");
  });

  it("期限切れトークンは RESET_TOKEN_INVALID", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "old-hash" });
    const token = "expired-token";
    db.resets.push({
      tokenHash: await hashToken(token),
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      usedAt: null,
    });

    const res = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
  });

  it("存在しないトークンは RESET_TOKEN_INVALID", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", RESET_URL, { body: { token: "never-issued", key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
  });

  it("鍵の形式が不正なら 400 INVALID_INPUT", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", RESET_URL, { body: { token: "some-token", key: "short", kdfVersion: KDF_VERSION } }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_INPUT");
  });

  it("token が無ければ 400 INVALID_INPUT", async () => {
    const db = new FakeD1();
    const res = await call(
      req("POST", RESET_URL, { body: { key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_INPUT");
  });

  it("壊れたJSON本文でも例外を投げず 400 を返す", async () => {
    const db = new FakeD1();
    const res = await call(req("POST", RESET_URL, { rawBody: "{not json" }), db);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("INVALID_INPUT");
  });
});

describe("ディスパッチ: 未知のパス・メソッド", () => {
  it("reset関連以外のパスは null を返す", async () => {
    const db = new FakeD1();
    const env = makeEnv(db);
    const res = await handleResetRoute(
      req("GET", "https://lifeplan.example.com/api/auth/me"),
      env,
      new URL("https://lifeplan.example.com/api/auth/me"),
    );
    expect(res).toBeNull();
  });

  it("既知のパスに対応しないメソッドは 405", async () => {
    const db = new FakeD1();
    const res = await call(req("GET", FORGOT_URL), db);
    expect(res.status).toBe(405);
  });
});

describe("全応答に cache-control: no-store が付く", () => {
  it("forgot-password と reset-password のいずれも no-store", async () => {
    const db = new FakeD1();
    const forgot = await call(req("POST", FORGOT_URL, { body: { email: "cache@example.com" } }), db);
    const reset = await call(
      req("POST", RESET_URL, { body: { token: "x", key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );
    expect(forgot.headers.get("cache-control")).toBe("no-store");
    expect(reset.headers.get("cache-control")).toBe("no-store");
  });
});
