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

describe("v1 からの移行", () => {
  beforeEach(() => {
    installMockStorage();
  });

  /** id を持たない旧スキーマのシート */
  const V1_SHEET = {
    currentAge: 45,
    occupation: "employee",
    householdNetIncome: 7_000_000,
    annualLivingCost: 4_200_000,
    savings: 2_000_000,
    investments: 8_000_000,
    retirementAge: 62,
    children: [
      { age: 10, path: "public" },
      { age: 7, path: "private" },
    ],
    customEvents: [{ age: 50, amount: 30_000_000, label: "住宅購入" }],
  };

  it("v1 しか無ければ読み出して v2 に変換する", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet();
    expect(loaded).not.toBeNull();
    expect(loaded!.currentAge).toBe(45);
    expect(loaded!.children).toHaveLength(2);
    expect(loaded!.customEvents).toHaveLength(1);
  });

  it("移行後、すべての行がIDを持つ", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet()!;
    for (const c of loaded.children!) {
      expect(c.id).toBeTruthy();
    }
    for (const e of loaded.customEvents!) {
      expect(e.id).toBeTruthy();
    }
  });

  it("移行後のIDは行ごとに異なる", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet()!;
    const ids = [
      ...loaded.children!.map((c) => c.id),
      ...loaded.customEvents!.map((e) => e.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("移行に成功したら v2 に保存し v1 を消す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    loadSheet();
    expect(localStorage.getItem("lifeplan.sheet.v2")).not.toBeNull();
    expect(localStorage.getItem("lifeplan.sheet.v1")).toBeNull();
  });

  it("v2 があれば v1 を見にいかない", () => {
    const v2 = { ...V1_SHEET, currentAge: 33, children: [], customEvents: [] };
    localStorage.setItem("lifeplan.sheet.v2", JSON.stringify(v2));
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    expect(loadSheet()!.currentAge).toBe(33);
    // v1 は残したまま。触っていないので消してはいけない
    expect(localStorage.getItem("lifeplan.sheet.v1")).not.toBeNull();
  });

  it("v1 が壊れていても例外を投げず、v1 を消さない", () => {
    localStorage.setItem("lifeplan.sheet.v1", "{壊れている");
    expect(loadSheet()).toBeNull();
    // 消してから失敗すると復旧手段が無くなる
    expect(localStorage.getItem("lifeplan.sheet.v1")).not.toBeNull();
  });

  it("v1 の必須項目が欠けていれば移行せず null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify({ currentAge: 40 }));
    expect(loadSheet()).toBeNull();
    expect(localStorage.getItem("lifeplan.sheet.v2")).toBeNull();
  });

  it("children や customEvents が無い v1 も移行できる", () => {
    const minimal = { ...V1_SHEET };
    delete (minimal as Record<string, unknown>).children;
    delete (minimal as Record<string, unknown>).customEvents;
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(minimal));
    const loaded = loadSheet();
    expect(loaded).not.toBeNull();
    expect(loaded!.children).toBeUndefined();
  });
});
