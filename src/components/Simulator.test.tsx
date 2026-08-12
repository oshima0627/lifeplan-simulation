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
