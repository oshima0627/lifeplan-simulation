// @vitest-environment jsdom
//
// 行の同一性（key）を検証するので jsdom が要る。
// 環境指定の作法は src/components/Simulator.test.tsx に合わせている

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { HearingForm } from "./HearingForm";

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

describe("HearingForm の行操作", () => {
  it("子供を追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<HearingForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    expect(latest.children).toHaveLength(1);
    expect(latest.children![0].id).toBeTruthy();
  });

  it("2人追加すると異なるIDになる", () => {
    let latest: HearingSheet = BASE;
    const { rerender } = render(
      <HearingForm sheet={latest} onChange={(s) => (latest = s)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    rerender(<HearingForm sheet={latest} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    expect(latest.children![0].id).not.toBe(latest.children![1].id);
  });

  it("真ん中の行を削除しても残る行のIDが変わらない", () => {
    const withThree: HearingSheet = {
      ...BASE,
      children: [
        { id: "a", age: 10, path: "public" },
        { id: "b", age: 7, path: "public" },
        { id: "c", age: 4, path: "public" },
      ],
    };
    let latest: HearingSheet = withThree;
    render(<HearingForm sheet={withThree} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "第2子を削除" }));
    expect(latest.children!.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("任意イベントを追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<HearingForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "大きな支出の予定を追加" }));
    expect(latest.customEvents![0].id).toBeTruthy();
  });
});
