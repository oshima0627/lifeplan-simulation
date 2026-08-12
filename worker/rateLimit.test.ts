import { describe, expect, it } from "vitest";
import { checkAndBump, hashForKey, todayUtc, type KvStore } from "./rateLimit";

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const puts: { key: string; value: string; ttl?: number }[] = [];
  const kv: KvStore = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, opts) {
      store.set(key, value);
      puts.push({ key, value, ttl: opts?.expirationTtl });
    },
  };
  return { kv, store, puts };
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
    const { kv, store } = fakeKv();
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });

  it("上限未満なら通して加算する", async () => {
    const { kv, store } = fakeKv({ k: "2" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("3");
  });

  it("上限に達していたら拒否する", async () => {
    const { kv } = fakeKv({ k: "3" });
    expect(await checkAndBump(kv, "k", 3)).toBe(false);
  });

  it("拒否したときは加算しない（TTLが無限に延びるのを防ぐ）", async () => {
    const { kv, store, puts } = fakeKv({ k: "3" });
    await checkAndBump(kv, "k", 3);
    expect(store.get("k")).toBe("3");
    expect(puts).toHaveLength(0);
  });

  it("TTLを付けて保存する", async () => {
    const { kv, puts } = fakeKv();
    await checkAndBump(kv, "k", 3);
    expect(puts[0].ttl).toBeGreaterThan(0);
  });

  it("壊れた値は0として扱う", async () => {
    const { kv, store } = fakeKv({ k: "garbage" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });

  it("負の値も0として扱う", async () => {
    const { kv, store } = fakeKv({ k: "-5" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });
});
