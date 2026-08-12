import { describe, expect, it } from "vitest";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  intOptions,
  moneyOptions,
  PENSION_OPTIONS,
  withCurrent,
} from "./options";

describe("moneyOptions", () => {
  it("min から max まで step 刻みで並ぶ", () => {
    expect(moneyOptions(0, 1_000_000, 500_000)).toEqual([0, 500_000, 1_000_000]);
  });

  it("max ちょうどに乗らない場合は max を超えない", () => {
    expect(moneyOptions(0, 900_000, 500_000)).toEqual([0, 500_000]);
  });
});

describe("intOptions", () => {
  it("両端を含む連番になる", () => {
    expect(intOptions(18, 21)).toEqual([18, 19, 20, 21]);
  });
});

describe("withCurrent", () => {
  it("選択肢に無い現在値を昇順の正しい位置に差し込む", () => {
    expect(withCurrent([0, 100, 200], 150)).toEqual([0, 100, 150, 200]);
  });

  it("すでに含まれていれば増やさない", () => {
    expect(withCurrent([0, 100, 200], 100)).toEqual([0, 100, 200]);
  });

  it("NaN は差し込まない", () => {
    expect(withCurrent([0, 100], Number.NaN)).toEqual([0, 100]);
  });

  it("元の配列を書き換えない", () => {
    const base = [0, 100];
    withCurrent(base, 50);
    expect(base).toEqual([0, 100]);
  });
});

describe("各項目の定数", () => {
  it("年収は100万〜3,000万を10万刻み", () => {
    expect(INCOME_OPTIONS[0]).toBe(1_000_000);
    expect(INCOME_OPTIONS.at(-1)).toBe(30_000_000);
    expect(INCOME_OPTIONS[1] - INCOME_OPTIONS[0]).toBe(100_000);
  });

  it("貯金・投資は0円から始まる", () => {
    expect(ASSET_OPTIONS[0]).toBe(0);
    expect(ASSET_OPTIONS.at(-1)).toBe(100_000_000);
  });

  it("年金は0円から5万円刻み", () => {
    expect(PENSION_OPTIONS[0]).toBe(0);
    expect(PENSION_OPTIONS[1]).toBe(50_000);
    expect(PENSION_OPTIONS.at(-1)).toBe(5_000_000);
  });

  it("現在年齢は18〜80", () => {
    expect(CURRENT_AGE_OPTIONS[0]).toBe(18);
    expect(CURRENT_AGE_OPTIONS.at(-1)).toBe(80);
  });
});
