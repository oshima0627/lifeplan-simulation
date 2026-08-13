// @vitest-environment jsdom
//
// ラベルとセレクトの結び付き・現在値の表示を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BarField } from "./BarField";

afterEach(() => {
  cleanup();
});

describe("BarField", () => {
  it("ラベルとセレクトが結び付いている", () => {
    render(
      <BarField label="現在の年齢" value={40} options={[39, 40, 41]} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("現在の年齢")).toHaveValue("40");
  });

  it("format を通した文字列が選択肢に出る", () => {
    render(
      <BarField
        label="現在の年齢"
        value={40}
        options={[39, 40]}
        onChange={() => {}}
        format={(v) => `${v}歳`}
      />,
    );
    expect(screen.getByRole("option", { name: "40歳" })).toBeInTheDocument();
  });

  it("選択すると数値で onChange が呼ばれる", () => {
    let latest = 0;
    render(
      <BarField
        label="現在の年齢"
        value={40}
        options={[39, 40, 41]}
        onChange={(v) => (latest = v)}
      />,
    );
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "41" } });
    expect(latest).toBe(41);
  });

  it("選択肢に無い現在値でも表示と実値が一致する（withCurrent）", () => {
    // 旧フォームは自由入力だったので、既存ユーザーの localStorage には
    // 刻みに乗らない値が入っている。差し込まないと画面と sheet が食い違う
    render(
      <BarField label="世帯手取り年収" value={6_123_456} options={[6_000_000, 7_000_000]} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("世帯手取り年収")).toHaveValue("6123456");
  });

  it("invalid のとき aria-invalid が立つ", () => {
    render(
      <BarField label="リタイア予定年齢" value={50} options={[50]} onChange={() => {}} invalid />,
    );
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("invalid でないとき aria-invalid は付かない", () => {
    render(<BarField label="リタイア予定年齢" value={50} options={[50]} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).not.toHaveAttribute("aria-invalid");
  });
});
