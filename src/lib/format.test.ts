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
});
