// @vitest-environment jsdom
//
// ステップ進行と開閉を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { HearingModal } from "./HearingModal";

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

describe("HearingModal", () => {
  it("open が false なら何も描画しない", () => {
    render(
      <HearingModal sheet={BASE} onChange={() => {}} open={false} onClose={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("最初のステップは「あなたのこと」", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("「次へ」で2番目のステップに進む", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("お金の流れ");
  });

  it("「戻る」で前のステップに戻る", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("最初のステップには「戻る」が無い", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "戻る" })).not.toBeInTheDocument();
  });

  it("必須の3ステップには「スキップ」が無い", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
  });

  it("4番目以降のステップには「スキップ」がある", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("button", { name: "スキップ" })).toBeInTheDocument();
  });

  it("最後のステップの「結果を見る」で閉じる", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape で閉じる", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ステップ内の選択が sheet に反映される", () => {
    let latest: HearingSheet = BASE;
    render(<HearingModal sheet={BASE} onChange={(s) => (latest = s)} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
  });

  it("開き直すと最初のステップから始まる", () => {
    const { rerender } = render(
      <HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    rerender(
      <HearingModal sheet={BASE} onChange={() => {}} open={false} onClose={() => {}} />,
    );
    rerender(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("「閉じる」ボタンをクリックすると onClose が呼ばれる（Finding C2）", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("黙って間違う条件の警告（Finding C1）", () => {
  it("Step 0: リタイア年齢が現在年齢を下回ると警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<HearingModal sheet={sheet} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
    expect(screen.getByText(/給与収入が全期間0円として/)).toBeInTheDocument();
  });

  it("Step 4: 年金受給開始年齢が現在年齢を下回ると警告が出る", () => {
    // retirementAge も妥当な値にしておく。BASE.retirementAge(65) のままだと
    // currentAge(70) がそれを上回り、リタイア側の警告文言（「現在の年齢より前に
    // なっています」）と重複して getByText が複数一致で例外を投げる
    const sheet: HearingSheet = {
      ...BASE,
      currentAge: 70,
      retirementAge: 70,
      pensionStartAge: 65,
    };
    render(<HearingModal sheet={sheet} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("老後");
    expect(screen.getByText(/現在の年齢より前になっています/)).toBeInTheDocument();
  });

  it("Step 5: 試算範囲外のイベントに警告が出る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      currentAge: 40,
      customEvents: [{ id: "e1", age: 30, amount: 1_000_000, label: "住宅購入" }],
    };
    render(<HearingModal sheet={sheet} onChange={() => {}} open onClose={() => {}} />);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    expect(screen.getByRole("dialog")).toHaveAccessibleName("大きな支出");
    expect(screen.getByText(/試算に反映されていません/)).toBeInTheDocument();
  });
});
