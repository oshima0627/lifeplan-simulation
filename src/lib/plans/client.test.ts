import { describe, expect, it, vi } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { createPlan, deletePlan, listPlans, loadPlan } from "./client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

const sheet: HearingSheet = {
  currentAge: 29,
  occupation: "employee",
  householdNetIncome: 6_500_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("保存プランのクライアント", () => {
  // 付け忘れるとセッション Cookie が送られず、全て 401 になる
  it("すべての呼び出しに credentials: same-origin を付ける", async () => {
    const f = fakeFetch(200, { plans: [] });
    await listPlans(f as unknown as typeof fetch);
    await createPlan({ name: "n", sheet }, f as unknown as typeof fetch);
    await deletePlan("p1", f as unknown as typeof fetch);
    for (const c of f.mock.calls) {
      expect((c[1] as RequestInit).credentials).toBe("same-origin");
    }
  });

  it("ID を URL に埋めるときエスケープする", async () => {
    const f = fakeFetch(200, { ok: true });
    await deletePlan("a/../b", f as unknown as typeof fetch);
    expect(f.mock.calls[0][0]).toBe("/api/plans/a%2F..%2Fb");
  });

  it("サーバーのエラー文言をそのまま返す", async () => {
    const f = fakeFetch(409, {
      error: { code: "PLAN_LIMIT_REACHED", message: "保存できるのは20件までです" },
    });
    const result = await createPlan({ name: "n", sheet }, f as unknown as typeof fetch);
    expect(result).toEqual({
      ok: false,
      code: "PLAN_LIMIT_REACHED",
      message: "保存できるのは20件までです",
    });
  });

  it("通信自体が失敗しても例外を投げない", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await listPlans(f as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  describe("loadPlan", () => {
    it("正しい入力はそのまま返す", async () => {
      const f = fakeFetch(200, { name: "n", sheet });
      const result = await loadPlan("p1", f as unknown as typeof fetch);
      expect(result).toEqual({ ok: true, value: { name: "n", sheet } });
    });

    // 入力の項目を変えたのに古い行が残っている場合。
    // 検証せずにフォームへ流すと画面が壊れる
    it("形が合わない保存内容は読み込まずに知らせる", async () => {
      const f = fakeFetch(200, { name: "古い", sheet: { currentAge: 29 } });
      const result = await loadPlan("p1", f as unknown as typeof fetch);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("PLAN_INCOMPATIBLE");
    });
  });
});
