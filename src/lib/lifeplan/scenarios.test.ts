import { describe, expect, it } from "vitest";
import { runAllScenarios } from "./scenarios";
import type { HearingSheet } from "./types";

/**
 * 資産が桁違いに大きく、悲観シナリオでも絶対に尽きない設定。
 *
 * 集約ロジックだけを検証したいので、財務的にぎりぎりの値は使わない。
 * 「このフィクスチャなら尽きるはず」を暗算で決めるとテストが壊れやすくなる
 */
const SAFE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 10_000_000,
  annualLivingCost: 1_000_000,
  savings: 10_000_000,
  investments: 500_000_000,
  retirementAge: 65,
  pensionAnnual: 3_000_000,
};

/** 資産ゼロ・収入より支出が桁違いに大きく、どのシナリオでも初年度から破綻する設定 */
const DOOMED: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 1_000_000,
  annualLivingCost: 20_000_000,
  savings: 0,
  investments: 0,
  retirementAge: 65,
};

/**
 * どのシナリオも初年度に大きな出費でマイナスへ落ちるが、その後の黒字（退職金＋
 * 年金が生活費を毎年上回り続ける）で95歳までに回復し、二度とマイナスに戻らない設定。
 * 全シナリオが temporaryShortfall = true / depletionAge = null になるはずで、
 * survivesAllScenarios が「尽きない」だけを見て true になってしまわないかを
 * 確認するための fixture。
 *
 * currentAge === retirementAge === pensionStartAge にして給与を0円に固定し、
 * 「年金（毎年）− 生活費（毎年）」の差が3シナリオとも一貫してプラスになるよう
 * 十分なマージンを持たせている（悲観シナリオは年金の伸びが生活費のインフレより
 * 遅いが、95歳までの期間内では逆転しない差を確保した）
 */
const TEMPORARY_SHORTFALL_ONLY: HearingSheet = {
  currentAge: 60,
  occupation: "employee",
  householdNetIncome: 0,
  annualLivingCost: 3_000_000,
  savings: 0,
  investments: 0,
  retirementAge: 60,
  retirementLumpSum: 2_000_000,
  pensionAnnual: 5_000_000,
  pensionStartAge: 60,
  customEvents: [{ age: 60, amount: 15_000_000, label: "初年度の大きな出費" }],
};

describe("runAllScenarios", () => {
  it("楽観・普通・悲観の3シナリオを返す", () => {
    const result = runAllScenarios(SAFE);
    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.map((s) => s.key)).toEqual([
      "optimistic",
      "baseline",
      "pessimistic",
    ]);
  });

  it("最終資産は楽観 > 普通 > 悲観の順になる", () => {
    const [opt, base, pes] = runAllScenarios(SAFE).scenarios;
    expect(opt.finalTotal).toBeGreaterThan(base.finalTotal);
    expect(base.finalTotal).toBeGreaterThan(pes.finalTotal);
  });

  it("全シナリオで資産が残れば survivesAllScenarios は true", () => {
    const result = runAllScenarios(SAFE);
    expect(result.scenarios.every((s) => s.depletionAge === null)).toBe(true);
    expect(result.survivesAllScenarios).toBe(true);
  });

  it("全シナリオで尽きれば survivesAllScenarios は false", () => {
    const result = runAllScenarios(DOOMED);
    expect(result.scenarios.every((s) => s.depletionAge === 40)).toBe(true);
    expect(result.survivesAllScenarios).toBe(false);
  });

  it("各シナリオが同じ年数ぶんの行を持つ", () => {
    const result = runAllScenarios(SAFE);
    const lengths = result.scenarios.map((s) => s.rows.length);
    expect(new Set(lengths).size).toBe(1);
  });

  it("全シナリオが一時的にマイナスへ落ちて回復するだけでも survivesAllScenarios は false になる", () => {
    const result = runAllScenarios(TEMPORARY_SHORTFALL_ONLY);

    // 前提: このfixtureはどのシナリオも実際には「尽きて」いない
    // （depletionAge は null）。それでも一時的な赤字があるので
    // 「尽きない」＝「計画は強い」と主張してはいけない
    expect(result.scenarios.every((s) => s.depletionAge === null)).toBe(true);
    expect(result.scenarios.some((s) => s.temporaryShortfall)).toBe(true);
    expect(result.survivesAllScenarios).toBe(false);
  });
});
