// @vitest-environment jsdom
//
// この1ファイルだけ jsdom 環境で動かす。理由は vitest.config.mts のコメントを参照。
// テスト対象は保存・復元・リセットのライフサイクル ── 実際に状態を持つロジックで、
// すでに一度「clearSheet() が保存エフェクトに即座に上書きされる」バグを生んでおり
// （§Simulator.tsx参照）、コードを読むだけでは正しさを確認しきれない部分

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    const input = await screen.findByLabelText(/^現在の年齢/);
    // 復元されていることを先に確認してから、リセットの効果を見る
    expect(input).toHaveValue("60");

    fireEvent.click(screen.getByText("入力内容を消して初期値に戻す"));

    expect(input).toHaveValue(String(DEFAULT_SHEET.currentAge));
    const persisted = loadSheet();
    expect(persisted?.currentAge).toBe(DEFAULT_SHEET.currentAge);
  });
});

describe("初回訪問のモーダル", () => {
  it("保存が無ければモーダルが開く", async () => {
    localStorage.clear();
    render(<Simulator />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("保存があればモーダルは開かない", async () => {
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
    // 復元エフェクトが走りきるのを待ってから確認する
    expect(await screen.findByText("入力をやり直す")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("「入力をやり直す」でモーダルが開く", async () => {
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
});
