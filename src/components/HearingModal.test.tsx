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
});
