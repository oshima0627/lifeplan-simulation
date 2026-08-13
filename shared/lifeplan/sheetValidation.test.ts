import { describe, expect, it } from "vitest";
import {
  isStorableSheet,
  MAX_SHEET_BYTES,
  normalizePlanName,
  parseStoredSheet,
  utf8ByteLength,
} from "./sheetValidation";

const valid = {
  currentAge: 29,
  occupation: "employee",
  householdNetIncome: 6_500_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("isStorableSheet", () => {
  it("必須項目が揃っていれば通る", () => {
    expect(isStorableSheet(valid)).toBe(true);
  });

  it("任意項目があっても通る", () => {
    expect(
      isStorableSheet({
        ...valid,
        children: [{ id: "c1", age: 3, path: "public" }],
        customEvents: [{ id: "e1", age: 40, amount: 30_000_000 }],
        retirementLumpSum: 10_000_000,
        pensionAnnual: 1_800_000,
        pensionStartAge: 65,
      }),
    ).toBe(true);
  });

  it.each(Object.keys(valid))("必須項目 %s が欠けたら弾く", (key) => {
    const broken: Record<string, unknown> = { ...valid };
    delete broken[key];
    expect(isStorableSheet(broken)).toBe(false);
  });

  it("職業が既知の値でなければ弾く", () => {
    expect(isStorableSheet({ ...valid, occupation: "ninja" })).toBe(false);
  });

  // JSON.parse は 1e999 を Infinity にする。エンジンに渡ると全金額が NaN になる
  it("Infinity を弾く", () => {
    const parsed = JSON.parse('{"savings": 1e999}') as { savings: number };
    expect(parsed.savings).toBe(Infinity);
    expect(isStorableSheet({ ...valid, savings: parsed.savings })).toBe(false);
  });

  it("数値のはずの項目が文字列なら弾く", () => {
    expect(isStorableSheet({ ...valid, savings: "3000000" })).toBe(false);
  });

  it("配列やnullは弾く", () => {
    expect(isStorableSheet([valid])).toBe(false);
    expect(isStorableSheet(null)).toBe(false);
  });

  it("子供の進路が不正なら弾く", () => {
    expect(isStorableSheet({ ...valid, children: [{ id: "c1", age: 3, path: "x" }] })).toBe(false);
  });

  it("children が配列でなければ弾く", () => {
    expect(isStorableSheet({ ...valid, children: { id: "c1" } })).toBe(false);
  });
});

describe("parseStoredSheet", () => {
  it("壊れた JSON は null", () => {
    expect(parseStoredSheet("{ではない")).toBeNull();
  });

  it("上限を超えたら読まずに null", () => {
    const huge = JSON.stringify({ ...valid, pad: "a".repeat(MAX_SHEET_BYTES) });
    expect(parseStoredSheet(huge)).toBeNull();
  });

  it("上限内なら読める", () => {
    expect(parseStoredSheet(JSON.stringify(valid))).toEqual(valid);
  });

  // string.length は UTF-16 の符号単位の数。日本語だと実際の保存量を見誤る
  it("上限はバイト数で見る（文字数ではない）", () => {
    const japanese = "あ".repeat(10);
    expect(japanese.length).toBe(10);
    expect(utf8ByteLength(japanese)).toBe(30);
  });
});

describe("normalizePlanName", () => {
  it("前後の空白を落とす", () => {
    expect(normalizePlanName("  子供2人の場合  ")).toBe("子供2人の場合");
  });

  it("空文字は許す（画面側が日付を出す）", () => {
    expect(normalizePlanName("   ")).toBe("");
  });

  it("長すぎたら null", () => {
    expect(normalizePlanName("あ".repeat(51))).toBeNull();
  });

  it("文字列でなければ null", () => {
    expect(normalizePlanName(123)).toBeNull();
  });
});
