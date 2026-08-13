// @vitest-environment jsdom
//
// ラベルと入力の結び付き・7項目の描画を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { BasicInfoFields } from "./BasicInfoFields";

afterEach(() => {
  cleanup();
});

const BASE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("BasicInfoFields", () => {
  it("基本情報の7項目が並ぶ", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    for (const label of [
      "現在の年齢",
      "職業",
      "世帯手取り年収",
      "年間の基本生活費",
      "現在の貯金",
      "現在の投資額",
      "リタイア予定年齢",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("ヒント文が出る（縦積みなので入る）", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    expect(screen.getByText("配偶者がいれば合算した額")).toBeInTheDocument();
    expect(screen.getByText("利回りがつかない現金")).toBeInTheDocument();
  });

  it("項目を変えるとシート全体を返す", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoFields sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
    expect(latest.retirementAge).toBe(65);
  });

  it("職業を変えられる", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoFields sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("職業"), { target: { value: "self_employed" } });
    expect(latest.occupation).toBe("self_employed");
  });

  it("リタイア年齢が不正なとき、その項目に aria-invalid が立つ", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoFields sheet={sheet} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("警告の文言はここには書かない（InputWarnings が持つ）", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoFields sheet={sheet} onChange={() => {}} />);
    expect(screen.queryByText(/給与収入が全期間0円/)).not.toBeInTheDocument();
  });

  it("年間収支（自動計算）が出る", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    // 600万 − 360万 = 240万
    expect(screen.getByText("2,400,000円")).toBeInTheDocument();
  });
});
