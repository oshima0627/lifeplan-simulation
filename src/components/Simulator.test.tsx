// @vitest-environment jsdom
//
// この1ファイルだけ jsdom 環境で動かす。理由は vitest.config.mts のコメントを参照。
// テスト対象は保存・復元・リセットのライフサイクル ── 実際に状態を持つロジックで、
// すでに一度「clearSheet() が保存エフェクトに即座に上書きされる」バグを生んでおり
// （§Simulator.tsx参照）、コードを読むだけでは正しさを確認しきれない部分

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { DEFAULT_SHEET, loadSheet, saveSheet } from "@/lib/storage";
import { Simulator } from "./Simulator";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Simulator の保存・復元・リセット", () => {
  it("localStorageに何も保存されていなければ既定値（DEFAULT_SHEET）を表示する", async () => {
    render(<Simulator />);
    // モーダルが自動で開くとラベルが二重になるので、先に閉じる
    fireEvent.keyDown(document, { key: "Escape" });

    const input = await screen.findByLabelText(/^現在の年齢/);
    expect(input).toHaveValue(String(DEFAULT_SHEET.currentAge));
  });

  it("localStorageに保存済みのシートがあれば、マウント後にそれを復元してフォームに反映する", async () => {
    const saved: HearingSheet = {
      ...DEFAULT_SHEET,
      currentAge: 52,
      householdNetIncome: 9_000_000,
    };
    saveSheet(saved);

    render(<Simulator />);
    // モーダルが自動で開くとラベルが二重になるので、先に閉じる
    fireEvent.keyDown(document, { key: "Escape" });

    const input = await screen.findByLabelText(/^現在の年齢/);
    expect(input).toHaveValue("52");
  });

  it("入力を変更するとlocalStorageに保存される", async () => {
    render(<Simulator />);
    // モーダルが自動で開くとラベルが二重になるので、先に閉じる
    fireEvent.keyDown(document, { key: "Escape" });
    const input = await screen.findByLabelText(/^現在の年齢/);

    fireEvent.change(input, { target: { value: "50" } });
    expect(input).toHaveValue("50");

    const persisted = loadSheet();
    expect(persisted?.currentAge).toBe(50);
  });

  it("リセットボタンを押すと既定値に戻り、localStorageも既定値になる（保存が復元前の既定値で上書きされて終わらないことを確認）", async () => {
    const saved: HearingSheet = { ...DEFAULT_SHEET, currentAge: 60 };
    saveSheet(saved);

    render(<Simulator />);
    // モーダルが自動で開くとラベルが二重になるので、先に閉じる
    fireEvent.keyDown(document, { key: "Escape" });
    const input = await screen.findByLabelText(/^現在の年齢/);
    // 復元されていることを先に確認してから、リセットの効果を見る
    expect(input).toHaveValue("60");

    fireEvent.click(screen.getByText("入力内容を消して初期値に戻す"));

    expect(input).toHaveValue(String(DEFAULT_SHEET.currentAge));
    const persisted = loadSheet();
    expect(persisted?.currentAge).toBe(DEFAULT_SHEET.currentAge);
  });
});

describe("ポップアップ", () => {
  it("保存が無ければモーダルが開く", async () => {
    localStorage.clear();
    render(<Simulator />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("保存があってもモーダルは開く（毎回開く）", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 40,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("毎回開くが、保存済みの値は復元されたうえで開く", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 52,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    const dialog = await screen.findByRole("dialog");
    // モーダル側の「現在の年齢」に復元値が入っていること
    expect(within(dialog).getByLabelText("現在の年齢")).toHaveValue("52");
  });

  it("閉じたあと「入力をやり直す」で開き直せる", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(await screen.findByText("入力をやり直す"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("既定値のまま1項目も変えずにモーダルを閉じても保存される（Finding M-3）", async () => {
    localStorage.clear();
    render(<Simulator />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(loadSheet()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(loadSheet()).not.toBeNull();
  });
});

describe("実質表示", () => {
  it("前提の説明に「今日の購買力」と実質の率が出る", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 40,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    expect(await screen.findByText(/今日の購買力に換算/)).toBeInTheDocument();
    expect(screen.getByText(/実質利回り5%/)).toBeInTheDocument();
  });

  it("95歳時点の額に「今日のお金で」が添えられる", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 40,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    expect((await screen.findAllByText("（今日のお金で）")).length).toBe(3);
  });

  // 以下2件は最終レビュー I-1 の指摘への対応。
  // 上の2件は「今日の購買力に換算」等の静的な文言の有無しか見ておらず、
  // Simulator.tsx の useMemo を変換前（runAllScenarios の結果をそのまま使う）に
  // 戻しても落ちない。ここでは DepletionVerdict に表示される実際の金額を、
  // 実際に runAllScenarios + toRealTerms を実行して得た値と突き合わせる。
  //
  // シート: 29歳・世帯手取り年収1,000万円・年間生活費360万円・貯金300万円・
  // 投資300万円・リタイア65歳（年金・退職金・子供は無し＝0扱い）。
  // 期待値は暗算ではなく、このシートに対して実際に
  // runAllScenarios(sheet) → toRealTerms(scenario, inflationPct) → formatCompactYen
  // を実行して得られた値（普通: 名目31.7億円/実質8.6億円、
  // 悲観: 名目11.7億円/実質1.7億円）。
  it("普通シナリオの95歳時点の額が実質値（8.6億円）で表示される。名目の31.7億円のままではない", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 29,
        occupation: "employee",
        householdNetIncome: 10_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);

    const label = await screen.findByText("普通");
    const card = label.closest("div.rounded") as HTMLElement;
    expect(card).not.toBeNull();

    // 実質値（正しい変換）が表示されていること
    expect(within(card).getByText(/8\.6億円/)).toBeInTheDocument();
    // 名目値（変換されていない値）は表示されていないこと。
    // useMemo を変換前に戻すとここが 31.7億円 になり、このアサーションが落ちる
    expect(within(card).queryByText(/31\.7億円/)).not.toBeInTheDocument();
  });

  it("悲観シナリオの95歳時点の額が正しいインフレ率3%で実質換算される（1.7億円）。インフレ率取り違えの1%（6.1億円）・2%（3.2億円）にはならない", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 29,
        occupation: "employee",
        householdNetIncome: 10_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);

    const label = await screen.findByText("悲観");
    const card = label.closest("div.rounded") as HTMLElement;
    expect(card).not.toBeNull();

    // 正しいインフレ率（3%）で割った実質値
    expect(within(card).getByText(/1\.7億円/)).toBeInTheDocument();
    // インフレ率を1%や2%と取り違えた場合の値（他シナリオの率との混同）ではないこと
    expect(within(card).queryByText(/6\.1億円/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/3\.2億円/)).not.toBeInTheDocument();
    // 名目値でもないこと
    expect(within(card).queryByText(/11\.7億円/)).not.toBeInTheDocument();
  });
});

describe("固定領域とスクロール領域の分離", () => {
  it("入力欄は固定領域の外にある（固定領域はグラフと判定のためのもの）", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    const fixedArea = document.querySelector(".sticky") as HTMLElement;
    expect(fixedArea).not.toBeNull();
    // 入力欄は左カラム側にある。固定領域の中には無い
    expect(within(fixedArea).queryByLabelText("現在の年齢")).not.toBeInTheDocument();
    expect(within(fixedArea).queryByLabelText("退職金")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("現在の年齢")).toBeInTheDocument();
    expect(screen.getByLabelText("退職金")).toBeInTheDocument();
  });

  it("警告行は固定領域の中にある（狭い画面で左カラムが消えても見えるように）", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    const fixedArea = document.querySelector(".sticky") as HTMLElement;
    expect(within(fixedArea).getByRole("status")).toBeInTheDocument();
  });

  it("「入力する」ボタンでポップアップが開く", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "入力する" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
