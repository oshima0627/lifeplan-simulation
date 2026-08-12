import { describe, expect, it, vi } from "vitest";
import type { Env } from "./env";

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

function makeEnv(): Env {
  return {
    ASSETS: { fetch: vi.fn() } as unknown as Env["ASSETS"],
    DB: {} as never,
  };
}

describe("worker.fetch の例外境界", () => {
  it("ハンドラ内の例外を 500 + JSON + no-store に変換する", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/health"), makeEnv());

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("応答本文に例外の生メッセージを含めない", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/health"), makeEnv());

    const bodyText = await res.text();
    expect(bodyText).not.toContain("boom");
    expect(bodyText).not.toContain("db connection string");
    expect(JSON.parse(bodyText)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "サーバーエラーが発生しました" },
    });
  });

  it("env.ASSETS.fetch は try の外なので、この例外境界の影響を受けない", async () => {
    const env = makeEnv();
    await worker.fetch(new Request("http://localhost/"), env);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
