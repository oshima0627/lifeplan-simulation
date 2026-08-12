import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../env";
import { hashForKey, todayUtc } from "../rateLimit";
import type { RateLimiter } from "../rateLimitDo";
import { handleResetRoute, RESET_TOKEN_TTL_MINUTES } from "./reset";
import { hashToken } from "./session";

// worker/auth/routes.test.ts の FakeD1 と同じ考え方: prepare/bind/run/first
// だけを実装した最小スタブ。worker/db.ts が発行する SQL 文の接頭辞で分岐する。

const KEY = "a".repeat(43);
const KDF_VERSION = 1;

// reset.ts のプライベート定数と同値（非公開なのでここで複製する。変えるときは
// 両方一緒に直す）。
const FORGOT_PASSWORD_EMAIL_DAILY_LIMIT = 5;
const FORGOT_PASSWORD_IP_DAILY_LIMIT = 30;
const RESET_PASSWORD_IP_DAILY_LIMIT = 60;
const RESET_TOKEN_IP_DAILY_LIMIT = 60;

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
      if (sql.startsWith("SELECT users.email AS email")) {
        // findEmailForValidPasswordReset: 消費しない照会。used_at を書き換えない。
        const [tokenHash, nowIso] = args as [string, string];
        const row = this.resets.find(
          (r) => r.tokenHash === tokenHash && r.usedAt === null && r.expiresAt > nowIso,
        );
        if (!row) return null;
        const user = this.users.find((u) => u.id === row.userId);
        return user ? ({ email: user.email } as T) : null;
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

interface StoredCounter {
  date: string;
  count: number;
}

/**
 * env.RATE_LIMITER（DurableObjectNamespace<RateLimiter>）のスタブ。
 * worker/rateLimit.test.ts の fakeRateLimiterNamespace と同型（DOの判断
 * ロジック自体は worker/rateLimitDo.test.ts でレビュー済みなので、ここでは
 * KVスタブと同じ「Mapで日次カウンタを覚える」振る舞いを再現するだけでよい）。
 *
 * `writes` は「許可されて実際に書き込みが発生した回数」の総計。IP別・
 * メール別のどちらのスコープ（キー）でも同じ Namespace を使い回す限り
 * 積み上がるので、「IP側の上限超過後はメール側の書き込みも増えない」
 * （I-1の再発防止）をこの1カウンタで検証できる。
 */
function fakeRateLimiterNamespace() {
  const rows = new Map<string, StoredCounter>();
  let writes = 0;

  const ns = {
    idFromName(name: string) {
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const name = id.toString();
      return {
        // 実物の RateLimiter.checkAndBump と同じシグネチャに揃えるためだけの引数
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async checkAndBump(_key: string, limit: number, _ttlSeconds: number): Promise<boolean> {
          const today = todayUtc();
          const existing = rows.get(name);
          const current = existing && existing.date === today ? existing.count : 0;
          if (current >= limit) return false;
          rows.set(name, { date: today, count: current + 1 });
          writes++;
          return true;
        },
      };
    },
  } as unknown as DurableObjectNamespace<RateLimiter>;

  return { ns, rows, getWrites: () => writes };
}

function resendSuccessResponse(): Response {
  return new Response(JSON.stringify({ id: "mail-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `ExecutionContext` のスタブ。`waitUntil` に渡された Promise を溜めておき、
 * `flush()` で明示的に待てるようにする（本物の Workers ランタイムは応答後も
 * これらを裏で完走させるが、テストでは結果を確認したい箇所でだけ `flush` する）。
 */
function makeCtx() {
  const pending: Promise<unknown>[] = [];
  let calls = 0;
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      calls++;
      pending.push(p);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    get callCount() {
      return calls;
    },
    flush: async () => {
      await Promise.allSettled(pending);
    },
  };
}

// sendPasswordResetMail はグローバル fetch を叩く（reset.ts は fetchImpl を
// 差し替えない）。既定では常に成功させ、失敗系だけその場で上書きする。
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => resendSuccessResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// env.RATE_LIMIT（KV）はもう読み書きされないが、wrangler.jsonc にバインディングが
// 残っている間は AppEnv の型上も必須。誤って参照されたら気付けるよう例外を投げる。
const UNUSED_RATE_LIMIT_KV = {
  get() {
    throw new Error("env.RATE_LIMIT は使われていないはず（DOへ移行済み）");
  },
  put() {
    throw new Error("env.RATE_LIMIT は使われていないはず（DOへ移行済み）");
  },
} as unknown as AppEnv["RATE_LIMIT"];

function makeEnv(
  db: FakeD1,
  rateLimiterNs: DurableObjectNamespace<RateLimiter> = fakeRateLimiterNamespace().ns,
): AppEnv {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as AppEnv["ASSETS"],
    DB: db as unknown as AppEnv["DB"],
    MAIL_FROM: "ライフプランシミュレーター <noreply@nexeed-lab.com>",
    APP_URL: "https://lifeplan.nexeed-lab.com",
    RESEND_API_KEY: "test-unused",
    RATE_LIMIT: UNUSED_RATE_LIMIT_KV,
    RATE_LIMITER: rateLimiterNs,
    TURNSTILE_SECRET_KEY: "test-unused",
  };
}

function req(
  method: string,
  url: string,
  opts: { body?: unknown; rawBody?: string; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {};
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
 * @param ctx 省略時は使い捨ての ExecutionContext を渡す（waitUntil に載った
 *   処理の完了は待たない）。バックグラウンド処理の結果を確認したいテストだけ、
 *   `makeCtx()` で作った ctx を明示的に渡し、呼び出し後に `flush()` する。
 */
async function call(
  request: Request,
  db: FakeD1,
  rateLimiterNs?: DurableObjectNamespace<RateLimiter>,
  ctx?: ExecutionContext,
): Promise<Response> {
  const env = makeEnv(db, rateLimiterNs);
  const res = await handleResetRoute(request, env, new URL(request.url), ctx ?? makeCtx().ctx);
  if (!res) throw new Error("handleResetRoute returned null for a known reset path");
  return res;
}

async function errorCode(res: Response): Promise<string> {
  return JSON.parse(await res.text()).error.code;
}

const FORGOT_URL = "https://lifeplan.example.com/api/auth/forgot-password";
const RESET_URL = "https://lifeplan.example.com/api/auth/reset-password";
const RESET_TOKEN_URL = "https://lifeplan.example.com/api/auth/reset-token";

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

describe("forgot-password: 応答時間でも登録済みかどうかを漏らさない（I-2）", () => {
  it("メール送信の完了を待たずに応答する（fetchが解決しなくてもタイムアウトしない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });

    // 意図的に解決しない Promise。応答がこれを待っていたら、このテスト自体が
    // vitest のデフォルトタイムアウトで失敗する
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(() => {})));

    const ctxHelper = makeCtx();
    const res = await call(
      req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }),
      db,
      undefined,
      ctxHelper.ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("登録済みアドレスなら ctx.waitUntil に1回だけ処理を載せる", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const ctxHelper = makeCtx();

    await call(req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }), db, undefined, ctxHelper.ctx);

    expect(ctxHelper.callCount).toBe(1);
  });

  it("未登録アドレスなら ctx.waitUntil を呼ばない", async () => {
    const db = new FakeD1();
    const ctxHelper = makeCtx();

    await call(req("POST", FORGOT_URL, { body: { email: "nobody@example.com" } }), db, undefined, ctxHelper.ctx);

    expect(ctxHelper.callCount).toBe(0);
  });
});

describe("forgot-password: 登録済みアドレスだけトークンを発行しメールを送る", () => {
  it("未登録アドレスでは password_resets に行が増えず、メールも送られない", async () => {
    const db = new FakeD1();
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);
    const ctxHelper = makeCtx();

    await call(req("POST", FORGOT_URL, { body: { email: "nobody@example.com" } }), db, undefined, ctxHelper.ctx);
    await ctxHelper.flush();

    expect(db.resets).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("登録済みアドレスでは password_resets に行が増え、Resend へ送信される（waitUntil完了後）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);
    const ctxHelper = makeCtx();

    await call(req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }), db, undefined, ctxHelper.ctx);
    await ctxHelper.flush();

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
    const ctxHelper = makeCtx();

    const res = await call(
      req("POST", FORGOT_URL, { body: { email: "exists@example.com" } }),
      db,
      undefined,
      ctxHelper.ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    await ctxHelper.flush();
    // トークン自体は既に発行済み（メール送信の失敗とは独立）
    expect(db.resets).toHaveLength(1);
  });
});

describe("forgot-password: レート制限はアドレスの有無に関わらず消費する", () => {
  it("未登録アドレスへの1回目の呼び出しでもメール単位のDOの枠が消費される", async () => {
    const db = new FakeD1();
    const { ns, rows } = fakeRateLimiterNamespace();
    const email = "nobody-rl@example.com";

    await call(req("POST", FORGOT_URL, { body: { email } }), db, ns);

    // M-1: メール別のスコープは forgot-password-email（forgot-password-ip とは別名前空間）
    const key = `rl:forgot-password-email:${todayUtc()}:${await hashForKey(email)}`;
    expect(rows.get(key)).toEqual({ date: todayUtc(), count: 1 });
  });

  it("未登録IPからの1回目の呼び出しでもIP単位のDOの枠が消費される", async () => {
    const db = new FakeD1();
    const { ns, rows } = fakeRateLimiterNamespace();
    const ip = "203.0.113.9";

    await call(req("POST", FORGOT_URL, { body: { email: "someone@example.com" }, ip }), db, ns);

    // M-1: IP別のスコープは forgot-password-ip（forgot-password-email とは別名前空間）
    const key = `rl:forgot-password-ip:${todayUtc()}:${await hashForKey(ip)}`;
    expect(rows.get(key)).toEqual({ date: todayUtc(), count: 1 });
  });

  it("登録済みアドレスがメール単位の上限を超えると、それ以降はトークンもメールも発行しない（応答は変えない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "limited@example.com", passwordHash: "irrelevant" });
    const { ns } = fakeRateLimiterNamespace();
    const fetchImpl = vi.fn().mockImplementation(async () => resendSuccessResponse());
    vi.stubGlobal("fetch", fetchImpl);
    const ctxHelper = makeCtx();

    for (let i = 0; i < FORGOT_PASSWORD_EMAIL_DAILY_LIMIT + 1; i++) {
      const res = await call(
        req("POST", FORGOT_URL, { body: { email: "limited@example.com" } }),
        db,
        ns,
        ctxHelper.ctx,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    await ctxHelper.flush();

    expect(db.resets).toHaveLength(FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);
    expect(fetchImpl).toHaveBeenCalledTimes(FORGOT_PASSWORD_EMAIL_DAILY_LIMIT);
  });

  it("IP単位の上限を超えると、初めて使う登録済みアドレスでもトークンを発行しない（I-3）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "victim-1", email: "victim@example.com", passwordHash: "irrelevant" });
    const { ns } = fakeRateLimiterNamespace();
    const ip = "203.0.113.50";
    const ctxHelper = makeCtx();

    // 別々のメールアドレスで IP の枠（30回/日）を使い切る
    for (let i = 0; i < FORGOT_PASSWORD_IP_DAILY_LIMIT; i++) {
      const res = await call(
        req("POST", FORGOT_URL, { body: { email: `filler-${i}@example.com` }, ip }),
        db,
        ns,
        ctxHelper.ctx,
      );
      expect(res.status).toBe(200);
    }

    // 31回目。victim@example.com はこのIPからは初めてのリクエストだが、
    // IP側の上限で弾かれ、応答は変わらないままトークンも作られない
    const res = await call(
      req("POST", FORGOT_URL, { body: { email: "victim@example.com" }, ip }),
      db,
      ns,
      ctxHelper.ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    await ctxHelper.flush();
    expect(db.resets).toHaveLength(0);
  });

  it("IP側の上限を超えた後は、宛先を変え続けてもメール別DOへの書き込みが増えない（I-1の再発防止）", async () => {
    const db = new FakeD1();
    const { ns, getWrites } = fakeRateLimiterNamespace();
    const ip = "203.0.113.51";
    const ctxHelper = makeCtx();

    // IP側の枠（30回/日）を、別々の宛先で使い切る
    // （このループだけで IP側30回分 + メール側30回分の書き込みが発生する）
    for (let i = 0; i < FORGOT_PASSWORD_IP_DAILY_LIMIT; i++) {
      await call(
        req("POST", FORGOT_URL, { body: { email: `filler-${i}@example.com` }, ip }),
        db,
        ns,
        ctxHelper.ctx,
      );
    }
    const writesAfterIpLimitReached = getWrites();

    // 31回目以降、宛先を変え続けてもIP側はもう書き込まれない（checkAndBump は
    // 上限到達時にDOへ書かない設計）。修正前はここでメール側の書き込みだけが
    // 無制限に増え続けていた（Workers Free の KV 1,000 writes/日 を1IPで
    // 枯渇させ、/api/auth/* 全体が 500 に落ちる経路だった。DOへ移した今も
    // 同じ不変条件を守る）。
    for (let i = 0; i < 50; i++) {
      const res = await call(
        req("POST", FORGOT_URL, { body: { email: `overflow-${i}@example.com` }, ip }),
        db,
        ns,
        ctxHelper.ctx,
      );
      expect(res.status).toBe(200);
    }

    expect(getWrites()).toBe(writesAfterIpLimitReached);
  });

  it("cf-connecting-ip が無いときはIP単位の制限がかからない（ローカル開発対応）", async () => {
    const db = new FakeD1();
    const { ns } = fakeRateLimiterNamespace();

    for (let i = 0; i < FORGOT_PASSWORD_IP_DAILY_LIMIT + 5; i++) {
      const res = await call(req("POST", FORGOT_URL, { body: { email: `no-ip-${i}@example.com` } }), db, ns);
      expect(res.status).toBe(200);
    }
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

describe("reset-password: IP別レート制限（60回/日、I-3）", () => {
  it("同一IPから61回目は 429 / RATE_LIMITED になる", async () => {
    const db = new FakeD1();
    const { ns } = fakeRateLimiterNamespace();
    const ip = "198.51.100.77";
    let last: Response | undefined;

    for (let i = 0; i < RESET_PASSWORD_IP_DAILY_LIMIT + 1; i++) {
      last = await call(
        req("POST", RESET_URL, { body: { token: `t-${i}`, key: KEY, kdfVersion: KDF_VERSION }, ip }),
        db,
        ns,
      );
    }

    expect(last!.status).toBe(429);
    expect(await errorCode(last!)).toBe("RATE_LIMITED");
  });

  it("cf-connecting-ip が無いときは何回呼んでも制限がかからない（ローカル開発対応）", async () => {
    const db = new FakeD1();
    const { ns } = fakeRateLimiterNamespace();

    for (let i = 0; i < RESET_PASSWORD_IP_DAILY_LIMIT + 1; i++) {
      const res = await call(
        req("POST", RESET_URL, { body: { token: `t2-${i}`, key: KEY, kdfVersion: KDF_VERSION } }),
        db,
        ns,
      );
      expect(res.status).not.toBe(429);
    }
  });
});

describe("reset-token: パスワード再設定画面のためのメールアドレス照会（消費しない）", () => {
  async function seedValidReset(db: FakeD1, userId: string, token: string): Promise<void> {
    db.resets.push({
      tokenHash: await hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
      usedAt: null,
    });
  }

  it("有効なトークンでメールアドレスが返る", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const token = "lookup-valid-token";
    await seedValidReset(db, "user-1", token);

    const res = await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "exists@example.com" });
  });

  it("期限切れのトークンは 400 RESET_TOKEN_INVALID（メールアドレスを返さない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const token = "lookup-expired-token";
    db.resets.push({
      tokenHash: await hashToken(token),
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      usedAt: null,
    });

    const res = await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
    const text = await res.text();
    expect(text).not.toContain("exists@example.com");
  });

  it("使用済みのトークンは 400 RESET_TOKEN_INVALID", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const token = "lookup-used-token";
    db.resets.push({
      tokenHash: await hashToken(token),
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: new Date().toISOString(),
    });

    const res = await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
  });

  it("存在しないトークンは 400 RESET_TOKEN_INVALID", async () => {
    const db = new FakeD1();
    const res = await call(req("GET", `${RESET_TOKEN_URL}?token=never-issued`), db);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
  });

  it("token パラメータが無ければ 400 RESET_TOKEN_INVALID", async () => {
    const db = new FakeD1();
    const res = await call(req("GET", RESET_TOKEN_URL), db);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("RESET_TOKEN_INVALID");
  });

  it("照会してもトークンは消費されない（照会後に reset-password が成功する）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "old-hash" });
    const token = "not-consumed-token";
    await seedValidReset(db, "user-1", token);

    // 同じトークンで何度照会しても、その後の本来の再設定は成功する
    const lookup1 = await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);
    const lookup2 = await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);
    expect(lookup1.status).toBe(200);
    expect(lookup2.status).toBe(200);

    const resetRes = await call(
      req("POST", RESET_URL, { body: { token, key: KEY, kdfVersion: KDF_VERSION } }),
      db,
    );

    expect(resetRes.status).toBe(200);
    expect(await resetRes.json()).toEqual({ ok: true });
    expect(db.users[0]?.passwordHash).not.toBe("old-hash");
  });

  it("照会後にトークンが使用済みになっていない（used_at が更新されない）", async () => {
    const db = new FakeD1();
    db.users.push({ id: "user-1", email: "exists@example.com", passwordHash: "irrelevant" });
    const token = "used-at-unchanged-token";
    await seedValidReset(db, "user-1", token);

    await call(req("GET", `${RESET_TOKEN_URL}?token=${token}`), db);

    const expectedHash = await hashToken(token);
    const persisted = db.resets.find((r) => r.tokenHash === expectedHash);
    expect(persisted?.usedAt).toBeNull();
  });

  it("既知のパスに GET 以外でアクセスすると 405", async () => {
    const db = new FakeD1();
    const res = await call(req("POST", `${RESET_TOKEN_URL}?token=x`), db);
    expect(res.status).toBe(405);
  });

  it("IP別レート制限（60回/日）を超えると 429 RATE_LIMITED", async () => {
    const db = new FakeD1();
    const { ns } = fakeRateLimiterNamespace();
    const ip = "198.51.100.200";
    let last: Response | undefined;

    for (let i = 0; i < RESET_TOKEN_IP_DAILY_LIMIT + 1; i++) {
      last = await call(req("GET", `${RESET_TOKEN_URL}?token=t-${i}`, { ip }), db, ns);
    }

    expect(last!.status).toBe(429);
    expect(await errorCode(last!)).toBe("RATE_LIMITED");
  });

  it("cf-connecting-ip が無いときは何回呼んでも制限がかからない（ローカル開発対応）", async () => {
    const db = new FakeD1();
    const { ns } = fakeRateLimiterNamespace();

    for (let i = 0; i < RESET_TOKEN_IP_DAILY_LIMIT + 1; i++) {
      const res = await call(req("GET", `${RESET_TOKEN_URL}?token=t2-${i}`), db, ns);
      expect(res.status).not.toBe(429);
    }
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
      makeCtx().ctx,
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
