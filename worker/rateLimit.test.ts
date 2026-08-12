import { describe, expect, it } from "vitest";
import { checkAndBump, hashForKey, todayUtc } from "./rateLimit";
import type { RateLimiter } from "./rateLimitDo";

// ⚠️ `RateLimiter.checkAndBump` の判断ロジック（境界・非加算・壊れた値の扱い）
// 自体は worker/rateLimitDo.test.ts で検証済み（レビューでKV版と完全一致を確認）。
// ここで確かめたいのは worker/rateLimit.ts の `checkAndBump` が正しく
// DOへ委譲すること（`idFromName` にキーを渡す・引数をそのまま伝える・
// 結果をそのまま返す）なので、DOと同じ判断ロジックをMapで模した最小の
// スタブを使う。

interface StoredCounter {
  date: string;
  count: number;
}

/** env.RATE_LIMITER（DurableObjectNamespace<RateLimiter>）相当のスタブ。 */
function fakeRateLimiterNamespace(now: () => Date = () => new Date()) {
  const rows = new Map<string, StoredCounter>();
  const writes: { key: string; count: number }[] = [];
  const idFromNameCalls: string[] = [];
  const ttlSecondsSeen: number[] = [];

  const ns = {
    idFromName(name: string) {
      idFromNameCalls.push(name);
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const name = id.toString();
      return {
        async checkAndBump(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
          ttlSecondsSeen.push(ttlSeconds);
          const today = todayUtc(now());
          const existing = rows.get(name);
          const current = existing && existing.date === today ? existing.count : 0;
          if (current >= limit) return false;
          rows.set(name, { date: today, count: current + 1 });
          writes.push({ key, count: current + 1 });
          return true;
        },
      };
    },
  } as unknown as DurableObjectNamespace<RateLimiter>;

  return { ns, rows, writes, idFromNameCalls, ttlSecondsSeen };
}

describe("todayUtc", () => {
  it("YYYYMMDD で返す", () => {
    expect(todayUtc(new Date("2026-08-12T23:59:59.000Z"))).toBe("20260812");
  });

  it("UTC基準で切る", () => {
    expect(todayUtc(new Date("2026-08-12T00:00:00.000Z"))).toBe("20260812");
  });
});

describe("hashForKey", () => {
  it("同じ入力なら同じ結果", async () => {
    expect(await hashForKey("1.2.3.4")).toBe(await hashForKey("1.2.3.4"));
  });

  it("違う入力なら違う結果", async () => {
    expect(await hashForKey("1.2.3.4")).not.toBe(await hashForKey("1.2.3.5"));
  });

  it("元の値を含まない（KVのキーに生IPを置かないため）", async () => {
    expect(await hashForKey("1.2.3.4")).not.toContain("1.2.3.4");
  });
});

describe("checkAndBump", () => {
  it("カウンタが無ければ通し、1にする", async () => {
    const { ns, rows } = fakeRateLimiterNamespace();
    expect(await checkAndBump(ns, "k", 3)).toBe(true);
    expect(rows.get("k")).toEqual({ date: todayUtc(), count: 1 });
  });

  it("上限未満なら通して加算する", async () => {
    const { ns, rows } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "k", 3);
    expect(await checkAndBump(ns, "k", 3)).toBe(true);
    expect(rows.get("k")).toEqual({ date: todayUtc(), count: 2 });
  });

  it("上限に達していたら拒否する", async () => {
    const { ns } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "k", 1);
    expect(await checkAndBump(ns, "k", 1)).toBe(false);
  });

  it("拒否したときは加算しない", async () => {
    const { ns, rows, writes } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "k", 1);
    const writesAfterFirst = writes.length;
    expect(await checkAndBump(ns, "k", 1)).toBe(false);
    expect(rows.get("k")).toEqual({ date: todayUtc(), count: 1 });
    expect(writes).toHaveLength(writesAfterFirst);
  });

  it("キーごとに別インスタンス（DOオブジェクト）を使う", async () => {
    const { ns, idFromNameCalls } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "ip-key", 5);
    await checkAndBump(ns, "email-key", 5);
    expect(idFromNameCalls).toEqual(["ip-key", "email-key"]);
  });

  it("ttlSecondsを省略するとデフォルト値がDOへ渡される", async () => {
    const { ns, ttlSecondsSeen } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "k", 3);
    expect(ttlSecondsSeen[0]).toBeGreaterThan(0);
  });

  it("ttlSecondsを明示すればそのままDOへ渡される", async () => {
    const { ns, ttlSecondsSeen } = fakeRateLimiterNamespace();
    await checkAndBump(ns, "k", 3, 999);
    expect(ttlSecondsSeen[0]).toBe(999);
  });
});
