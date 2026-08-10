import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHEET, clearSheet, loadSheet, saveSheet } from "./storage";
import type { HearingSheet } from "./lifeplan/types";

/** localStorage の最小実装。Vitest の node 環境には存在しないため差し込む */
function installMockStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

describe("ヒアリングシートの永続化", () => {
  beforeEach(() => {
    installMockStorage();
  });

  it("保存していなければ null を返す", () => {
    expect(loadSheet()).toBeNull();
  });

  it("保存した内容をそのまま復元できる", () => {
    const sheet: HearingSheet = { ...DEFAULT_SHEET, currentAge: 45, savings: 1_000_000 };
    saveSheet(sheet);
    expect(loadSheet()).toEqual(sheet);
  });

  it("消したら null に戻る", () => {
    saveSheet(DEFAULT_SHEET);
    clearSheet();
    expect(loadSheet()).toBeNull();
  });

  it("壊れたJSONが入っていても例外を投げず null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", "{壊れている");
    expect(loadSheet()).toBeNull();
  });

  it("必須項目が欠けた古いデータは null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify({ currentAge: 40 }));
    expect(loadSheet()).toBeNull();
  });

  it("localStorage が使えない環境でも例外を投げない", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveSheet(DEFAULT_SHEET)).not.toThrow();
    expect(loadSheet()).toBeNull();
  });

  it("既定値は Tier 1 をすべて埋めている", () => {
    expect(DEFAULT_SHEET.currentAge).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.householdNetIncome).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.annualLivingCost).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.retirementAge).toBeGreaterThan(DEFAULT_SHEET.currentAge);
  });
});
