import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../env";
import { MAX_PLANS_PER_USER, MAX_SHEET_BYTES } from "../../shared/lifeplan/sheetValidation";

// ログイン状態はここで差し替える。検証したいのは
// 「未認証を通さないか」「他人のプランに触れないか」であって、
// Cookie の読み方や SHA-256 の実装ではない（そちらは auth 側のテストが持つ）。
let loggedInAs: string | null = null;
vi.mock("../auth/current", () => ({
  currentUserId: async () => loggedInAs,
}));

const { handlePlansRoute } = await import("./routes");

interface Row {
  id: string;
  userId: string;
  name: string;
  sheetJson: string;
  schemaVersion: number;
}

/**
 * 実物の SQLite で検証済みの挙動を再現する最小スタブ。
 * とくに「id だけでなく user_id でも絞る」ことを、SQL 文の中身を見て再現する。
 */
class FakeD1 {
  rows: Row[] = [];

  prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        if (sql.includes("INSERT INTO plans")) {
          const [id, userId, name, sheetJson, schemaVersion] = args as [
            string,
            string,
            string,
            string,
            number,
          ];
          const limit = args[args.length - 1] as number;
          if (this.rows.filter((r) => r.userId === userId).length >= limit) {
            return { meta: { changes: 0 } };
          }
          this.rows.push({ id, userId, name, sheetJson, schemaVersion });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE plans")) {
          const [name, sheetJson, schemaVersion, , planId, userId] = args as [
            string,
            string,
            number,
            string,
            string,
            string,
          ];
          const row = this.rows.find((r) => r.id === planId && r.userId === userId);
          if (!row) return { meta: { changes: 0 } };
          Object.assign(row, { name, sheetJson, schemaVersion });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM plans")) {
          const [planId, userId] = args as [string, string];
          const before = this.rows.length;
          this.rows = this.rows.filter((r) => !(r.id === planId && r.userId === userId));
          return { meta: { changes: before - this.rows.length } };
        }
        throw new Error(`想定外のSQL: ${sql}`);
      },
      first: async () => {
        if (sql.includes("FROM plans WHERE id = ? AND user_id = ?")) {
          const [planId, userId] = args as [string, string];
          const row = this.rows.find((r) => r.id === planId && r.userId === userId);
          if (!row) return null;
          return {
            id: row.id,
            name: row.name,
            sheet_json: row.sheetJson,
            schema_version: row.schemaVersion,
            created_at: "t",
            updated_at: "t",
          };
        }
        throw new Error(`想定外のSQL: ${sql}`);
      },
      all: async () => {
        if (sql.includes("FROM plans WHERE user_id = ?")) {
          const [userId] = args as [string];
          return {
            results: this.rows
              .filter((r) => r.userId === userId)
              .map((r) => ({ id: r.id, name: r.name, created_at: "t", updated_at: "t" })),
          };
        }
        throw new Error(`想定外のSQL: ${sql}`);
      },
    }),
  });
}

function makeEnv(db: FakeD1): AppEnv {
  return { DB: db as unknown as AppEnv["DB"] } as unknown as AppEnv;
}

const sheet = {
  currentAge: 29,
  occupation: "employee",
  householdNetIncome: 6_500_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

function call(
  method: string,
  path: string,
  env: AppEnv,
  body?: unknown,
): Promise<Response | null> {
  const url = new URL(`https://example.com${path}`);
  const request = new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return handlePlansRoute(request, env, url);
}

describe("handlePlansRoute", () => {
  beforeEach(() => {
    loggedInAs = "userA";
  });

  it("別パスは null を返して他のルータに渡す", async () => {
    const url = new URL("https://example.com/api/auth/me");
    expect(await handlePlansRoute(new Request(url), makeEnv(new FakeD1()), url)).toBeNull();
  });

  it("/api/plansfoo のような紛らわしいパスは拾わない", async () => {
    const url = new URL("https://example.com/api/plansfoo");
    expect(await handlePlansRoute(new Request(url), makeEnv(new FakeD1()), url)).toBeNull();
  });

  describe("未認証", () => {
    beforeEach(() => {
      loggedInAs = null;
    });

    it.each([
      ["GET", "/api/plans"],
      ["POST", "/api/plans"],
      ["GET", "/api/plans/p1"],
      ["PUT", "/api/plans/p1"],
      ["DELETE", "/api/plans/p1"],
    ])("%s %s は 401", async (method, path) => {
      const res = await call(method, path, makeEnv(new FakeD1()));
      expect(res?.status).toBe(401);
    });

    it("未認証では DB に一切触らない", async () => {
      const db = new FakeD1();
      db.prepare = () => {
        throw new Error("DBに触ってはいけない");
      };
      const res = await call("GET", "/api/plans", makeEnv(db));
      expect(res?.status).toBe(401);
    });
  });

  it("保存して一覧に出る", async () => {
    const env = makeEnv(new FakeD1());
    const created = await call("POST", "/api/plans", env, { name: "子供2人", sheet });
    expect(created?.status).toBe(201);

    const list = await call("GET", "/api/plans", env);
    const body = (await list!.json()) as { plans: { name: string }[] };
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].name).toBe("子供2人");
  });

  it("一覧に入力そのものを含めない（重くなるため）", async () => {
    const env = makeEnv(new FakeD1());
    await call("POST", "/api/plans", env, { name: "n", sheet });
    const list = await call("GET", "/api/plans", env);
    expect(await list!.text()).not.toContain("householdNetIncome");
  });

  // ⚠️ D1 に RLS は無い。ここが破れると他人の家計情報が読める
  describe("他人のプラン", () => {
    async function setupOthersPlan() {
      const env = makeEnv(new FakeD1());
      loggedInAs = "userB";
      const created = await call("POST", "/api/plans", env, { name: "Bのプラン", sheet });
      const { id } = (await created!.json()) as { id: string };
      loggedInAs = "userA";
      return { env, id };
    }

    it("読めない。しかも 403 ではなく 404（存在を漏らさない）", async () => {
      const { env, id } = await setupOthersPlan();
      const res = await call("GET", `/api/plans/${id}`, env);
      expect(res?.status).toBe(404);
    });

    it("更新できない", async () => {
      const { env, id } = await setupOthersPlan();
      const res = await call("PUT", `/api/plans/${id}`, env, { name: "乗っ取り", sheet });
      expect(res?.status).toBe(404);
    });

    it("削除できない", async () => {
      const { env, id } = await setupOthersPlan();
      const res = await call("DELETE", `/api/plans/${id}`, env);
      expect(res?.status).toBe(404);

      loggedInAs = "userB";
      const list = await call("GET", "/api/plans", env);
      expect(((await list!.json()) as { plans: unknown[] }).plans).toHaveLength(1);
    });

    it("一覧にも出ない", async () => {
      const { env } = await setupOthersPlan();
      const list = await call("GET", "/api/plans", env);
      expect(((await list!.json()) as { plans: unknown[] }).plans).toHaveLength(0);
    });
  });

  it("上限を超えたら 409", async () => {
    const env = makeEnv(new FakeD1());
    for (let i = 0; i < MAX_PLANS_PER_USER; i++) {
      const res = await call("POST", "/api/plans", env, { name: `n${i}`, sheet });
      expect(res?.status).toBe(201);
    }
    const over = await call("POST", "/api/plans", env, { name: "over", sheet });
    expect(over?.status).toBe(409);
  });

  it("壊れた入力は 400", async () => {
    const env = makeEnv(new FakeD1());
    const res = await call("POST", "/api/plans", env, { name: "n", sheet: { currentAge: 29 } });
    expect(res?.status).toBe(400);
  });

  it("大きすぎる入力は 400", async () => {
    const env = makeEnv(new FakeD1());
    const huge = { ...sheet, customEvents: [] as unknown[] };
    // 上限を確実に超える数のイベントを積む
    for (let i = 0; i < MAX_SHEET_BYTES / 20; i++) {
      huge.customEvents.push({ id: `e${i}`, age: 40, amount: 1 });
    }
    const res = await call("POST", "/api/plans", env, { name: "n", sheet: huge });
    expect(res?.status).toBe(400);
  });

  it("名前が長すぎたら 400", async () => {
    const env = makeEnv(new FakeD1());
    const res = await call("POST", "/api/plans", env, { name: "あ".repeat(51), sheet });
    expect(res?.status).toBe(400);
  });

  it("名前を省略しても保存できる", async () => {
    const env = makeEnv(new FakeD1());
    expect((await call("POST", "/api/plans", env, { sheet }))?.status).toBe(201);
  });

  it("本文が JSON でなくても落ちない", async () => {
    const env = makeEnv(new FakeD1());
    const url = new URL("https://example.com/api/plans");
    const res = await handlePlansRoute(
      new Request(url, { method: "POST", body: "not json" }),
      env,
      url,
    );
    expect(res?.status).toBe(400);
  });

  it.each([
    ["/api/plans/", "空のID"],
    ["/api/plans/a/b", "階層が深いパス"],
  ])("%s は 404（%s）", async (path) => {
    expect((await call("GET", path, makeEnv(new FakeD1())))?.status).toBe(404);
  });

  it("メソッド違いは 405", async () => {
    expect((await call("PATCH", "/api/plans", makeEnv(new FakeD1())))?.status).toBe(405);
    expect((await call("POST", "/api/plans/p1", makeEnv(new FakeD1())))?.status).toBe(405);
  });

  it("保存したものを読み戻せる", async () => {
    const env = makeEnv(new FakeD1());
    const created = await call("POST", "/api/plans", env, { name: "n", sheet });
    const { id } = (await created!.json()) as { id: string };
    const got = await call("GET", `/api/plans/${id}`, env);
    const body = (await got!.json()) as { sheet: unknown; name: string };
    expect(body.sheet).toEqual(sheet);
    expect(body.name).toBe("n");
  });
});
