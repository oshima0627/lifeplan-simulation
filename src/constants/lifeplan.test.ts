import { describe, expect, it } from "vitest";
import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
  REAL_SCENARIOS,
  SCENARIOS,
  UNIVERSITY_ENTRANCE_FEE,
} from "./lifeplan";

describe("ライフプラン定数", () => {
  it("3シナリオが楽観・普通・悲観の順に揃っている", () => {
    expect(SCENARIOS.map((s) => s.key)).toEqual([
      "optimistic",
      "baseline",
      "pessimistic",
    ]);
  });

  it("利回りは楽観 > 普通 > 悲観、インフレ率は逆順になっている", () => {
    const [opt, base, pes] = SCENARIOS;
    expect(opt.returnPct).toBeGreaterThan(base.returnPct);
    expect(base.returnPct).toBeGreaterThan(pes.returnPct);
    expect(opt.inflationPct).toBeLessThan(base.inflationPct);
    expect(base.inflationPct).toBeLessThan(pes.inflationPct);
  });

  it("年金スライド幅は楽観 < 普通 < 悲観の順になっている（悲観ほど年金の目減りを織り込む）", () => {
    const [opt, base, pes] = SCENARIOS;
    expect(opt.pensionSlidePct).toBeLessThan(base.pensionSlidePct);
    expect(base.pensionSlidePct).toBeLessThan(pes.pensionSlidePct);
    expect(opt.pensionSlidePct).toBe(0);
  });

  it("年金スライド幅の3値を固定する（docs/requirements.md §5.1.1 に基づくモデル前提であり、実装の詳細ではない）", () => {
    const [opt, base, pes] = SCENARIOS;
    expect(opt.pensionSlidePct).toBe(0);
    expect(base.pensionSlidePct).toBe(0.5);
    expect(pes.pensionSlidePct).toBe(1.0);
  });

  it("教育費テーブルが全段階ぶん揃っている", () => {
    for (const path of ["public", "private"] as const) {
      for (const { stage } of EDUCATION_STAGES) {
        expect(EDUCATION_ANNUAL_COST[path][stage]).toBeGreaterThan(0);
      }
    }
  });

  it("私立はどの段階でも公立より高い", () => {
    for (const { stage } of EDUCATION_STAGES) {
      expect(EDUCATION_ANNUAL_COST.private[stage]).toBeGreaterThan(
        EDUCATION_ANNUAL_COST.public[stage],
      );
    }
  });

  it("進学段階が年齢の重複なく連続している", () => {
    for (let i = 1; i < EDUCATION_STAGES.length; i++) {
      expect(EDUCATION_STAGES[i].startAge).toBe(EDUCATION_STAGES[i - 1].endAge + 1);
    }
  });

  it("大学の入学料が両方の進路で設定されている", () => {
    expect(UNIVERSITY_ENTRANCE_FEE.public).toBeGreaterThan(0);
    expect(UNIVERSITY_ENTRANCE_FEE.private).toBeGreaterThan(0);
  });

  it("試算終了年齢は95歳", () => {
    expect(LIFE_EXPECTANCY_AGE).toBe(95);
  });
});

describe("シナリオ定数（実質ベース）", () => {
  it("実質の値が設計書 §4.6.3 のとおり", () => {
    expect(REAL_SCENARIOS.map((s) => [s.key, s.realReturnPct, s.realRaisePct])).toEqual([
      ["optimistic", 5, 1],
      ["baseline", 3, 0],
      ["pessimistic", 1, -1],
    ]);
  });

  it("インフレ率と年金スライドは従来どおり", () => {
    expect(SCENARIOS.map((s) => [s.inflationPct, s.pensionSlidePct])).toEqual([
      [1, 0],
      [2, 0.5],
      [3, 1],
    ]);
  });

  it("名目利回りは (1+実質)×(1+インフレ)-1 になる", () => {
    // 楽観: 1.05 × 1.01 - 1 = 6.05%
    expect(SCENARIOS[0].returnPct).toBeCloseTo(6.05, 6);
    // 普通: 1.03 × 1.02 - 1 = 5.06%
    expect(SCENARIOS[1].returnPct).toBeCloseTo(5.06, 6);
    // 悲観: 1.01 × 1.03 - 1 = 4.03%
    expect(SCENARIOS[2].returnPct).toBeCloseTo(4.03, 6);
  });

  it("名目昇給は (1+実質昇給)×(1+インフレ)-1 になる", () => {
    // 楽観: 1.01 × 1.01 - 1 = 2.01%
    expect(SCENARIOS[0].raisePct).toBeCloseTo(2.01, 6);
    // 普通: 1.00 × 1.02 - 1 = 2.00%
    expect(SCENARIOS[1].raisePct).toBeCloseTo(2.0, 6);
    // 悲観: 0.99 × 1.03 - 1 = 1.97%
    expect(SCENARIOS[2].raisePct).toBeCloseTo(1.97, 6);
  });

  it("悲観の実質昇給が -1% であること（-2.9% は破滅シナリオだった）", () => {
    // 36年で実質収入が7割に。日本の実績に近く「悪いが起こりうる」範囲。
    // 変更前の実質 -2.91% は36年で3分の1になり、誰が試算しても破綻していた
    expect(REAL_SCENARIOS[2].realRaisePct).toBe(-1);
    expect(0.99 ** 36).toBeGreaterThan(0.69);
  });
});
