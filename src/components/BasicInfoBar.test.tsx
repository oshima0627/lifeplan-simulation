// @vitest-environment jsdom
//
// 警告行の出し分けと8項目の描画を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { BasicInfoBar } from "./BasicInfoBar";

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

describe("BasicInfoBar の項目", () => {
  it("基本情報の7項目が並ぶ", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
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

  it("年間収支は「手取り年収 − 生活費」で出る", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    // 600万 − 360万 = 240万
    // ⚠️ selector で span に絞る。240万円は世帯手取り年収・年間の基本生活費の
    // 各セレクトの <option> にも同じ刻みの値として存在するため、素の getByText では
    // 複数ヒットしてしまう（テキスト自体は変えていない）
    expect(screen.getByText("240万円", { selector: "span" })).toBeInTheDocument();
  });

  it("年間収支は入力欄ではない（非対話のバッジ）", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    expect(screen.queryByLabelText("年間収支")).not.toBeInTheDocument();
  });

  it("項目を変えるとシート全体を返す", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoBar sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
    // 他の項目が落ちていないこと
    expect(latest.retirementAge).toBe(65);
  });

  it("職業を変えられる", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoBar sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("職業"), { target: { value: "self_employed" } });
    expect(latest.occupation).toBe("self_employed");
  });
});

describe("BasicInfoBar の警告行", () => {
  it("入力が妥当なら role=status の要素はあるが中身は空", () => {
    // role="status" の要素自体は常に描画し、中身だけを出し入れする（最終レビュー指摘 F4）。
    // 要素ごと出し入れすると、ライブリージョンが中身と同時にDOMへ挿入されることになり、
    // スクリーンリーダーの実装によっては読み上げが発火しないことがある
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("リタイア年齢が現在年齢を下回ると role=status の警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/給与収入が全期間0円/);
  });

  it("リタイア年齢が不正なとき、その項目に aria-invalid が立つ", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("年金の受給開始年齢が不正なときも、警告はこのバーに出る", () => {
    // 項目そのものは任意項目としてスクロール領域にあるが、
    // 「黙って間違っている」ことはスクロールせずに気づける場所に出す
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/年金の受給開始年齢/);
  });

  it("年金の受給開始年齢の警告には、フォーム側と同じ「直し方」が添えられる（最終レビュー指摘 F5）", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/現在の年齢以上に修正してください/);
  });

  it("2つとも不正なら両方の文言が1つの status に出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 65, pensionStartAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/給与収入が全期間0円/);
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
  });
});
