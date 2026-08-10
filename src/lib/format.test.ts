import { describe, expect, it } from "vitest";
import { formatCompactYen, formatYen } from "./format";

describe("formatYen", () => {
  it("3桁区切りで円を付ける", () => {
    expect(formatYen(1_234_567)).toBe("1,234,567円");
  });

  it("0を扱える", () => {
    expect(formatYen(0)).toBe("0円");
  });

  it("マイナスを扱える", () => {
    expect(formatYen(-500_000)).toBe("-500,000円");
  });
});

describe("formatCompactYen", () => {
  it("1万円未満はそのまま円で表す", () => {
    expect(formatCompactYen(5_000)).toBe("5,000円");
  });

  it("万円単位に丸める", () => {
    expect(formatCompactYen(12_340_000)).toBe("1,234万円");
  });

  it("1億円以上は億で表す", () => {
    expect(formatCompactYen(123_400_000)).toBe("1.2億円");
  });

  it("マイナスでも単位が付く", () => {
    expect(formatCompactYen(-12_340_000)).toBe("-1,234万円");
  });

  it("0は0円", () => {
    expect(formatCompactYen(0)).toBe("0円");
  });

  it("円→万円の境界（10,000円）で切り替わる", () => {
    expect(formatCompactYen(9_999)).toBe("9,999円");
    expect(formatCompactYen(10_000)).toBe("1万円");
  });

  it("万円→億円の境界（100,000,000円 = 10,000万円）で切り替わる", () => {
    expect(formatCompactYen(100_000_000)).toBe("1.0億円");
  });

  it("四捨五入で10,000万円に達する額は、1億円未満でも億表記になる（不連続をなくす）", () => {
    // 99,999,999円は万円に丸めると10,000万円（=1億円）に達するため、
    // 「10,000万円」ではなく100,000,000円と同じ「1.0億円」にする
    expect(formatCompactYen(99_999_999)).toBe("1.0億円");
  });

  it("1億円未満では万円単位のまま、10,000万円ちょうどには達しない", () => {
    expect(formatCompactYen(99_940_000)).toBe("9,994万円");
  });
});
