// @vitest-environment jsdom
//
// 警告の出し分けと role="status" の常設を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { InputWarnings } from "./InputWarnings";

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

describe("InputWarnings", () => {
  it("入力が妥当でも role=status の要素は常に描画される", () => {
    // ⚠️ 要素ごと出し入れすると、ライブリージョンが中身と同時にDOMへ挿入され、
    // スクリーンリーダーの実装によっては読み上げが発火しない
    render(<InputWarnings sheet={BASE} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("入力が妥当なら中身は空", () => {
    render(<InputWarnings sheet={BASE} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("リタイア年齢が現在年齢を下回ると警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<InputWarnings sheet={sheet} />);
    expect(screen.getByRole("status")).toHaveTextContent(/給与収入が全期間0円/);
  });

  it("年金の受給開始年齢が現在年齢を下回ると、直し方つきの警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 };
    render(<InputWarnings sheet={sheet} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
    expect(status).toHaveTextContent(/現在の年齢以上に修正してください/);
  });

  it("2つとも不正なら両方の文言が1つの status に出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 65, pensionStartAge: 65 };
    render(<InputWarnings sheet={sheet} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/給与収入が全期間0円/);
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
  });
});
