import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ⚠️ Vitest の node 環境には Durable Objects の実行環境が無い（このプロジェクトの
// vitest.config.mts は environment: "node" で、@cloudflare/vitest-pool-workers も
// 入っていない）。そのため `DurableObjectState` 相当を自分でスタブし、
// `RateLimiter` を直接 `new` してテストする。
//
// `worker/rateLimitDo.ts` は `import { DurableObject } from "cloudflare:workers"`
// を使う。これはCloudflareのランタイム（workerd）が提供する仮想モジュールで、
// プレーンな Node 上の Vitest では解決できない（`Cannot find package
// 'cloudflare:workers'` で即クラッシュする。実際に確認済み）。このファイルの
// 範囲だけで完結させるため（vitest.config.mts などプロジェクト全体の設定は
// このタスクでは変更しない）、`vi.mock` でこの1指定子だけを差し替える。
// 中身は実物と同じ契約（`protected ctx` / `protected env` を持ち、
// コンストラクタで受け取った値をそのまま保持するだけ）を持つ最小のクラス。
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

// `vi.mock` は Vitest が自動的にファイル先頭へ巻き上げるため、この静的 import
// より後ろに書いても上のモックが先に効く。
import { RateLimiter } from "./rateLimitDo";

// スタブは実物の契約を模す。特に `ctx.storage.sql.exec(...)` の戻り値
// （SqlStorageCursor）は `node_modules/@cloudflare/workers-types/index.d.ts` で
// 確認した実際の型に合わせ、`.toArray()` と `.one()`、`Symbol.iterator` を
// 持つオブジェクトを返す。実装コードが使っていない `.raw()` / `columnNames` /
// `rowsRead` / `rowsWritten` は用意しない（呼ばれたらすぐ気付けるよう、
// あえて省略する）。

interface StoredRow {
  date: string;
  count: unknown;
}

/** 実物の SqlStorageCursor と同じ形（.toArray() / .one() / イテレータ）を持つ最小実装。 */
class FakeCursor<T extends Record<string, unknown>> {
  constructor(private readonly rows: T[]) {}

  toArray(): T[] {
    return this.rows;
  }

  one(): T {
    if (this.rows.length !== 1) {
      throw new Error(`FakeCursor.one(): expected exactly one row, got ${this.rows.length}`);
    }
    return this.rows[0];
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.rows[Symbol.iterator]();
  }
}

/**
 * `RateLimiter` が実際に発行するクエリだけを解釈する最小のSQLスタブ。
 * 未対応のクエリが来たら（実装が変わってスタブが追従できていないサイン
 * なので）例外を投げて気付けるようにする。
 */
function createFakeSql(table: Map<string, StoredRow>) {
  const execCalls: { query: string; bindings: unknown[] }[] = [];

  return {
    execCalls,
    exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): FakeCursor<T> {
      execCalls.push({ query, bindings });
      const q = query.trim();

      if (/^CREATE TABLE/i.test(q)) {
        return new FakeCursor<T>([]);
      }

      if (/^SELECT/i.test(q)) {
        const [scope] = bindings as [string];
        const row = table.get(scope);
        return new FakeCursor<T>(row ? ([{ date: row.date, count: row.count }] as unknown as T[]) : []);
      }

      if (/^INSERT/i.test(q)) {
        const [scope, date, count] = bindings as [string, string, number];
        table.set(scope, { date, count });
        return new FakeCursor<T>([]);
      }

      throw new Error(`FakeSql: unsupported query in stub: ${query}`);
    },
  };
}

function createFakeState() {
  const table = new Map<string, StoredRow>();
  const fakeSql = createFakeSql(table);
  const setAlarmCalls: (number | Date)[] = [];
  let deleteAllCalls = 0;

  const storage = {
    sql: fakeSql as unknown as DurableObjectStorage["sql"],
    async setAlarm(scheduledTime: number | Date) {
      setAlarmCalls.push(scheduledTime);
    },
    async deleteAll() {
      deleteAllCalls++;
      table.clear();
    },
    // 以下はこのDOが呼ばない DurableObjectStorage のメンバ。呼ばれたら
    // スタブが甘くて本番と乖離している証拠なので、黙って動くのではなく
    // 例外で気付けるようにする。
    async get() {
      throw new Error("FakeStorage.get: RateLimiter はKVストレージAPIを使わないはず");
    },
    async put() {
      throw new Error("FakeStorage.put: RateLimiter はKVストレージAPIを使わないはず");
    },
    async delete() {
      throw new Error("FakeStorage.delete: RateLimiter はKVストレージAPIを使わないはず");
    },
    async list() {
      throw new Error("FakeStorage.list: RateLimiter はKVストレージAPIを使わないはず");
    },
    async transaction() {
      throw new Error("FakeStorage.transaction: 未使用");
    },
    async getAlarm() {
      throw new Error("FakeStorage.getAlarm: 未使用");
    },
    async deleteAlarm() {
      throw new Error("FakeStorage.deleteAlarm: 未使用");
    },
    async sync() {
      throw new Error("FakeStorage.sync: 未使用");
    },
  } as unknown as DurableObjectStorage;

  const id = {
    toString: () => "fake-id",
    equals: () => false,
    name: undefined,
  } as unknown as DurableObjectId;

  const state = {
    waitUntil() {},
    exports: {} as never,
    props: undefined,
    id,
    storage,
    container: undefined,
    facets: {} as never,
    // 本物は「コールバックが終わるまで他の呼び出しを直列化してブロックする」だが、
    // RateLimiter のコンストラクタが渡すコールバックは await を挟まない同期処理
    // なので、そのまま呼ぶだけで十分に実物の効果を再現できる。
    async blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T> {
      return cb();
    },
    acceptWebSocket() {
      throw new Error("FakeState.acceptWebSocket: 未使用");
    },
    getWebSockets() {
      return [];
    },
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponse() {
      return null;
    },
    getWebSocketAutoResponseTimestamp() {
      return null;
    },
    setHibernatableWebSocketEventTimeout() {},
    getHibernatableWebSocketEventTimeout() {
      return null;
    },
    getTags() {
      return [];
    },
    abort() {},
  } as unknown as DurableObjectState;

  return { state, table, setAlarmCalls, getDeleteAllCalls: () => deleteAllCalls, fakeSql };
}

function makeLimiter() {
  const fake = createFakeState();
  const env = {} as Env;
  const limiter = new RateLimiter(fake.state, env);
  return { limiter, ...fake };
}

const FIXED_NOW = new Date("2026-08-12T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RateLimiter.checkAndBump", () => {
  it("カウンタが無ければ通し、1にする", async () => {
    const { limiter, table } = makeLimiter();
    expect(await limiter.checkAndBump("signup", 3, 3600)).toBe(true);
    expect(table.get("signup")).toEqual({ date: "20260812", count: 1 });
  });

  it("上限未満なら通して加算する", async () => {
    const { limiter, table } = makeLimiter();
    await limiter.checkAndBump("signup", 3, 3600);
    await limiter.checkAndBump("signup", 3, 3600);
    expect(table.get("signup")).toEqual({ date: "20260812", count: 2 });
  });

  it("上限に達していたら拒否し、加算しない", async () => {
    const { limiter, table } = makeLimiter();
    await limiter.checkAndBump("signup", 2, 3600); // 1
    await limiter.checkAndBump("signup", 2, 3600); // 2 (上限)
    const allowed = await limiter.checkAndBump("signup", 2, 3600); // 拒否されるはず
    expect(allowed).toBe(false);
    expect(table.get("signup")).toEqual({ date: "20260812", count: 2 });
  });

  it("日付が変わったらカウントが0に戻る", async () => {
    const { limiter, table } = makeLimiter();
    await limiter.checkAndBump("signup", 2, 3600); // 1
    await limiter.checkAndBump("signup", 2, 3600); // 2 (上限)
    expect(await limiter.checkAndBump("signup", 2, 3600)).toBe(false);

    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z")); // 日付が変わる

    expect(await limiter.checkAndBump("signup", 2, 3600)).toBe(true);
    expect(table.get("signup")).toEqual({ date: "20260813", count: 1 });
  });

  it("スコープが違えば独立して数える（signup と login が干渉しない）", async () => {
    const { limiter, table } = makeLimiter();
    await limiter.checkAndBump("signup", 5, 3600);
    await limiter.checkAndBump("signup", 5, 3600);
    await limiter.checkAndBump("login", 5, 3600);

    expect(table.get("signup")).toEqual({ date: "20260812", count: 2 });
    expect(table.get("login")).toEqual({ date: "20260812", count: 1 });
  });

  it("壊れた値を0として扱う", async () => {
    const { limiter, table } = makeLimiter();
    table.set("signup", { date: "20260812", count: "garbage" });

    expect(await limiter.checkAndBump("signup", 3, 3600)).toBe(true);
    expect(table.get("signup")).toEqual({ date: "20260812", count: 1 });
  });

  it("負の値を0として扱う", async () => {
    const { limiter, table } = makeLimiter();
    table.set("signup", { date: "20260812", count: -5 });

    expect(await limiter.checkAndBump("signup", 3, 3600)).toBe(true);
    expect(table.get("signup")).toEqual({ date: "20260812", count: 1 });
  });

  it("setAlarm が呼ばれる（最終利用から48時間で掃除するためのTTL延長）", async () => {
    const { limiter, setAlarmCalls } = makeLimiter();
    await limiter.checkAndBump("signup", 3, 3600);

    expect(setAlarmCalls).toHaveLength(1);
    expect(setAlarmCalls[0]).toBe(FIXED_NOW.getTime() + 48 * 60 * 60 * 1000);
  });

  it("拒否したときも setAlarm を呼ぶ（拒否もこのDOの「利用」の一種）", async () => {
    const { limiter, setAlarmCalls } = makeLimiter();
    await limiter.checkAndBump("signup", 0, 3600); // 上限0なので即拒否

    expect(setAlarmCalls).toHaveLength(1);
  });
});

describe("RateLimiter.alarm", () => {
  it("deleteAll() を呼ぶ", async () => {
    const { limiter, getDeleteAllCalls } = makeLimiter();
    await limiter.checkAndBump("signup", 3, 3600);
    expect(getDeleteAllCalls()).toBe(0);

    await limiter.alarm();

    expect(getDeleteAllCalls()).toBe(1);
  });

  it("deleteAll() 後はカウンタが消える", async () => {
    const { limiter, table } = makeLimiter();
    await limiter.checkAndBump("signup", 3, 3600);
    expect(table.size).toBe(1);

    await limiter.alarm();

    expect(table.size).toBe(0);
  });
});
