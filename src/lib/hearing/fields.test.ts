import { describe, expect, it } from "vitest";
import { HEARING_FIELDS, fieldSpec } from "./fields";

describe("HEARING_FIELDS", () => {
  it("Tier 1 は仕様の7項目を過不足なく持つ", () => {
    const tier1 = HEARING_FIELDS.filter((f) => f.tier === 1).map((f) => f.key);
    expect(new Set(tier1)).toEqual(
      new Set([
        "currentAge",
        "occupation",
        "householdNetIncome",
        "annualLivingCost",
        "savings",
        "investments",
        "retirementAge",
      ]),
    );
  });

  it("Tier 2 は仕様の5項目を持つ", () => {
    const tier2 = HEARING_FIELDS.filter((f) => f.tier === 2).map((f) => f.key);
    expect(new Set(tier2)).toEqual(
      new Set([
        "children",
        "retirementLumpSum",
        "pensionAnnual",
        "pensionStartAge",
        "customEvents",
      ]),
    );
  });

  it("キーが重複していない", () => {
    const keys = HEARING_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("すべての項目が日本語の表示名を持つ", () => {
    for (const f of HEARING_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("数値項目は検証範囲を持つ", () => {
    for (const f of HEARING_FIELDS) {
      if (f.kind === "number") {
        expect(f.min).toBeTypeOf("number");
        expect(f.max).toBeTypeOf("number");
        expect(f.max).toBeGreaterThan(f.min);
      }
    }
  });

  it("fieldSpec はキーから定義を引ける", () => {
    expect(fieldSpec("currentAge").tier).toBe(1);
    expect(fieldSpec("pensionAnnual").tier).toBe(2);
  });

  it("Tier 1 の項目は聞く順序が定義の順に並んでいる", () => {
    // 年齢 → 職業 → 収入 → 支出 → 資産 → リタイア年齢 の順で聞く。
    // いきなり資産額から聞かれると答えにくいため
    const tier1 = HEARING_FIELDS.filter((f) => f.tier === 1).map((f) => f.key);
    expect(tier1[0]).toBe("currentAge");
    expect(tier1.at(-1)).toBe("retirementAge");
  });
});
