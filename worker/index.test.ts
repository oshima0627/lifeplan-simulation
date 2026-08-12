import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "./env";

// ⚠️ `worker/index.ts` は `export { RateLimiter } from "./rateLimitDo"` を持つ
// （デプロイ時に `Class "RateLimiter" not found` にならないため必須）。
// `./rateLimitDo` は `import { DurableObject } from "cloudflare:workers"` を
// 使っており、これはworkerdが提供する仮想モジュールでプレーンなNode上の
// Vitestでは解決できない。`worker/rateLimitDo.test.ts` と同じ理由・同じ形の
// スタブで、この1指定子だけを差し替える（詳しくは同ファイルのコメント参照）。
vi.mock("cloudflare:workers", () => {
  class DurableObject<Env = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(ctx: DurableObjectState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  }
  return { DurableObject };
});

/**
 * `/api/health` 自体は例外を投げない（現時点では顕在化しないバグのため）。
 * `json()` をこのテストファイルの中だけ例外を投げる実装に差し替えることで、
 * `worker/index.ts` の構造（`fetch` のシグネチャや分岐）を一切変えずに、
 * 本番で D1 が絡んだときと同じ「ハンドラの途中で例外が投げられる」経路を
 * 実際に通す。`errorResponse` は本物のままなので、catch が組み立てる
 * 応答も本物の実装で検証できる。
 */
vi.mock("./http", async () => {
  const actual = await vi.importActual<typeof import("./http")>("./http");
  return {
    ...actual,
    json: () => {
      throw new Error("boom: db connection string leaked here");
    },
  };
});

const { default: worker } = await import("./index");

function makeEnv(): AppEnv {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as AppEnv["ASSETS"],
    DB: {} as never,
    MAIL_FROM: "ライフプランシミュレーター <noreply@nexeed-lab.com>",
    APP_URL: "https://lifeplan.nexeed-lab.com",
    RESEND_API_KEY: "test-unused",
    RATE_LIMIT: {} as never,
    RATE_LIMITER: {} as never,
    TURNSTILE_SECRET_KEY: "test-unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    STRIPE_WEBHOOK_SECRET: "whsec_test_unused",
    // vars はリテラル型で生成されるため、実IDに差し替えた時に
    // テストが壊れないようキャストで受ける
    STRIPE_PRICE_ID: "price_test_unused" as AppEnv["STRIPE_PRICE_ID"],
  };
}

/**
 * `ExecutionContext` のスタブ。`worker.fetch` の第3引数として必須になった
 * （`worker/auth/reset.ts` の forgot-password が `waitUntil` を使うため）。
 * このファイルのテストはいずれも `/api/health` または静的アセット経路のみで
 * `waitUntil` に到達しないため、呼ばれたかどうかの検証はしない。
 */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe("worker.fetch の例外境界", () => {
  it("ハンドラ内の例外を 500 + JSON + no-store に変換する", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/health"), makeEnv(), makeCtx());

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("応答本文に例外の生メッセージを含めない", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/health"), makeEnv(), makeCtx());

    const bodyText = await res.text();
    expect(bodyText).not.toContain("boom");
    expect(bodyText).not.toContain("db connection string");
    expect(JSON.parse(bodyText)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "サーバーエラーが発生しました" },
    });
  });

  it("env.ASSETS.fetch は try の外なので、この例外境界の影響を受けない", async () => {
    const env = makeEnv();
    await worker.fetch(new Request("http://localhost/"), env, makeCtx());
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
