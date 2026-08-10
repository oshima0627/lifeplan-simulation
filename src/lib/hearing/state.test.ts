import { describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { currentPhase, missingFields, nextField, progress } from "./state";

/** Tier 1 がすべて埋まったシート */
const TIER1_DONE: Partial<HearingSheet> = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("missingFields", () => {
  it("空のシートでは Tier 1 が7項目すべて未入力", () => {
    expect(missingFields({}, 1)).toHaveLength(7);
  });

  it("埋まった項目は未入力に含まれない", () => {
    const missing = missingFields({ currentAge: 40 }, 1);
    expect(missing).not.toContain("currentAge");
    expect(missing).toHaveLength(6);
  });

  it("Tier 1 が揃えば未入力は空になる", () => {
    expect(missingFields(TIER1_DONE, 1)).toEqual([]);
  });

  it("0 は「入力済み」として扱う", () => {
    // 貯金0円・年金0円は正当な入力。未入力と混同すると永久に聞き続ける
    const missing = missingFields({ ...TIER1_DONE, savings: 0 }, 1);
    expect(missing).not.toContain("savings");
  });

  it("undefined は未入力として扱う", () => {
    const missing = missingFields({ ...TIER1_DONE, savings: undefined }, 1);
    expect(missing).toContain("savings");
  });

  it("Tier 2 の未入力も数えられる", () => {
    expect(missingFields({}, 2)).toHaveLength(5);
    expect(missingFields({ pensionAnnual: 1_800_000 }, 2)).toHaveLength(4);
  });

  it("空配列は「入力済み」として扱う", () => {
    // 「子供はいません」と答えた結果の空配列は、聞き終わった状態
    expect(missingFields({ children: [] }, 2)).not.toContain("children");
  });
});

describe("currentPhase", () => {
  it("Tier 1 に未入力があれば tier1", () => {
    expect(currentPhase({})).toBe("tier1");
    expect(currentPhase({ currentAge: 40 })).toBe("tier1");
  });

  it("Tier 1 が揃い Tier 2 が残っていれば tier2", () => {
    expect(currentPhase(TIER1_DONE)).toBe("tier2");
  });

  it("すべて揃えば complete", () => {
    const all: Partial<HearingSheet> = {
      ...TIER1_DONE,
      children: [],
      retirementLumpSum: 0,
      pensionAnnual: 1_800_000,
      pensionStartAge: 65,
      customEvents: [],
    };
    expect(currentPhase(all)).toBe("complete");
  });
});

describe("nextField", () => {
  it("空のシートでは定義順の先頭を返す", () => {
    expect(nextField({})).toBe("currentAge");
  });

  it("埋まった項目は飛ばす", () => {
    expect(nextField({ currentAge: 40 })).toBe("occupation");
  });

  it("Tier 1 を終えたら Tier 2 の先頭に進む", () => {
    expect(nextField(TIER1_DONE)).toBe("children");
  });

  it("すべて揃えば null を返す", () => {
    const all: Partial<HearingSheet> = {
      ...TIER1_DONE,
      children: [],
      retirementLumpSum: 0,
      pensionAnnual: 1_800_000,
      pensionStartAge: 65,
      customEvents: [],
    };
    expect(nextField(all)).toBeNull();
  });

  it("Tier 1 が残っていれば Tier 2 が埋まっていても Tier 1 を優先する", () => {
    // 計算できない状態のまま任意項目を聞き続けるのを防ぐ
    expect(nextField({ pensionAnnual: 1_800_000 })).toBe("currentAge");
  });
});

describe("progress", () => {
  it("空のシートは 0 / 12", () => {
    expect(progress({})).toEqual({ filled: 0, total: 12 });
  });

  it("Tier 1 が揃えば 7 / 12", () => {
    expect(progress(TIER1_DONE)).toEqual({ filled: 7, total: 12 });
  });

  it("進捗は LLM ではなくこの関数が算出する", () => {
    // §3.1: 進捗の表示も含め、状態の管理はすべてコード側の責務
    const p = progress({ currentAge: 40, occupation: "employee" });
    expect(p.filled).toBe(2);
  });
});
