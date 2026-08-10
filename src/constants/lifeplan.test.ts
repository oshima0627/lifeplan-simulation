import { describe, expect, it } from "vitest";
import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
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
