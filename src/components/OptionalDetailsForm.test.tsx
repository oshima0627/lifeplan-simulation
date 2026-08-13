// @vitest-environment jsdom
//
// 行の同一性（key）を検証するので jsdom が要る。
// 環境指定の作法は src/components/Simulator.test.tsx に合わせている

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { OptionalDetailsForm } from "./OptionalDetailsForm";

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

describe("OptionalDetailsForm の行操作", () => {
  it("子供を追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<OptionalDetailsForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    expect(latest.children).toHaveLength(1);
    expect(latest.children![0].id).toBeTruthy();
  });

  it("2人追加すると異なるIDになる", () => {
    let latest: HearingSheet = BASE;
    const { rerender } = render(
      <OptionalDetailsForm sheet={latest} onChange={(s) => (latest = s)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    rerender(<OptionalDetailsForm sheet={latest} onChange={(s) => (latest = s)} />);
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
    render(<OptionalDetailsForm sheet={withThree} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "第2子を削除" }));
    expect(latest.children!.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("先頭の行を削除しても、残る行のDOM要素は使い回されない（React の key が id に基づく証拠, Finding 4）", () => {
    const withThree: HearingSheet = {
      ...BASE,
      children: [
        { id: "a", age: 10, path: "public" },
        { id: "b", age: 7, path: "public" },
        { id: "c", age: 4, path: "public" },
      ],
    };
    let latest: HearingSheet = withThree;
    const { rerender } = render(
      <OptionalDetailsForm sheet={withThree} onChange={(s) => (latest = s)} />,
    );

    // 3行目（id: c, 4歳）の年齢入力欄の DOM ノードを覚えておく
    const thirdRowInputBefore = screen.getByDisplayValue("4") as HTMLInputElement;

    // 1行目（id: a）を削除する
    fireEvent.click(screen.getByRole("button", { name: "第1子を削除" }));
    rerender(<OptionalDetailsForm sheet={latest} onChange={(s) => (latest = s)} />);

    // 削除後、元3行目だった行（id: c）は新しい2行目として表示されている
    const thirdRowInputAfter = screen.getByDisplayValue("4") as HTMLInputElement;

    // key が id 基準なら、React は c 行の既存 DOM ノードをそのまま再利用する。
    // key が配列インデックス基準に戻ると、index 1 の位置には元の b 行（7歳）の
    // ノードが再利用され、c 行の値だけが後から書き込まれる形になり、
    // このノード同一性が崩れる
    expect(thirdRowInputAfter).toBe(thirdRowInputBefore);
    expect(thirdRowInputAfter.value).toBe("4");
  });

  it("任意イベントを追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<OptionalDetailsForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "大きな支出の予定を追加" }));
    expect(latest.customEvents![0].id).toBeTruthy();
  });
});

describe("黙って間違う条件の警告", () => {
  it("年金受給開始年齢が現在年齢を下回ると警告が出る", () => {
    // retirementAge はここでは検証しない（リタイア年齢の警告は BasicInfoBar に
    // 一本化済みで、このコンポーネントは表示しない）。BASE の65のままでよい
    const sheet: HearingSheet = { ...BASE, currentAge: 70, pensionStartAge: 65 };
    render(<OptionalDetailsForm sheet={sheet} onChange={() => {}} />);
    expect(screen.getByText(/現在の年齢より前になっています/)).toBeInTheDocument();
  });

  it("試算範囲外のイベントに警告が出る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      currentAge: 40,
      customEvents: [{ id: "e1", age: 30, amount: 1_000_000, label: "住宅購入" }],
    };
    render(<OptionalDetailsForm sheet={sheet} onChange={() => {}} />);
    expect(screen.getByText(/試算に反映されていません/)).toBeInTheDocument();
  });
});

describe("基本情報の切り出し", () => {
  it("基本情報はここには無い（バーへ移った）", () => {
    render(<OptionalDetailsForm sheet={BASE} onChange={() => {}} />);
    expect(screen.queryByLabelText("現在の年齢")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("世帯手取り年収")).not.toBeInTheDocument();
  });
});
