import { describe, expect, it } from "vitest";
import { deflate, toRealTerms } from "./realTerms";
import type { ScenarioResult, YearRow } from "./types";

function row(age: number, total: number): YearRow {
  return {
    age,
    income: total,
    expense: 0,
    balance: total,
    savings: total,
    investments: 0,
    total,
    events: [],
  };
}

describe("deflate", () => {
  it("経過0年なら変わらない", () => {
    expect(deflate(1_000_000, 2, 0)).toBe(1_000_000);
  });

  it("インフレ0%なら何年経っても変わらない", () => {
    expect(deflate(1_000_000, 0, 30)).toBe(1_000_000);
  });

  it("インフレ2%・1年で 1/1.02 になる", () => {
    expect(deflate(1_020_000, 2, 1)).toBe(1_000_000);
  });

  it("マイナスの値も同じ率で縮む", () => {
    expect(deflate(-1_020_000, 2, 1)).toBe(-1_000_000);
  });

  it("整数に丸める", () => {
    expect(Number.isInteger(deflate(1_000_000, 3, 7))).toBe(true);
  });
});

describe("toRealTerms", () => {
  const nominal: ScenarioResult = {
    key: "baseline",
    label: "普通",
    rows: [row(40, 1_000_000), row(41, 1_020_000)],
    depletionAge: null,
    temporaryShortfall: false,
    finalTotal: 1_020_000,
  };

  it("先頭の年（経過0年）は変わらない", () => {
    expect(toRealTerms(nominal, 2).rows[0].total).toBe(1_000_000);
  });

  it("翌年はインフレ1年分だけ割り引かれる", () => {
    expect(toRealTerms(nominal, 2).rows[1].total).toBe(1_000_000);
  });

  it("finalTotal は最終年の経過年数で割り引く", () => {
    expect(toRealTerms(nominal, 2).finalTotal).toBe(1_000_000);
  });

  it("枯渇年齢と一時的資金不足は変えない（主指標は不変）", () => {
    const depleted: ScenarioResult = {
      ...nominal,
      depletionAge: 79,
      temporaryShortfall: false,
    };
    const real = toRealTerms(depleted, 3);
    expect(real.depletionAge).toBe(79);
    expect(real.temporaryShortfall).toBe(false);
  });

  it("年齢とイベントラベルはそのまま残る", () => {
    const withEvent: ScenarioResult = {
      ...nominal,
      rows: [{ ...row(40, 1_000_000), events: ["長子 小学校"] }],
    };
    const real = toRealTerms(withEvent, 2);
    expect(real.rows[0].age).toBe(40);
    expect(real.rows[0].events).toEqual(["長子 小学校"]);
  });

  it("元のオブジェクトを書き換えない", () => {
    const before = nominal.rows[1].total;
    toRealTerms(nominal, 2);
    expect(nominal.rows[1].total).toBe(before);
  });

  it("空のシナリオでも落ちない", () => {
    const empty: ScenarioResult = { ...nominal, rows: [], finalTotal: 0 };
    expect(toRealTerms(empty, 2).rows).toEqual([]);
    expect(toRealTerms(empty, 2).finalTotal).toBe(0);
  });
});
