// @vitest-environment jsdom
//
// NumberField は制御コンポーネントの入力欄。丸め・クランプのタイミングを誤ると
// 「40 を 25 に打ち替える」という基本操作そのものが成立しなくなる不具合を過去に
// 起こしている（onChange のたびに min/max/integer を適用していたケース）。
// ここでは (1) 入力途中は min でクランプされないこと、(2) blur 時にだけ
// 整数丸め・範囲クランプが効くことの2つを固定する。
//
// value/onChange を外側の変数で手動管理するのではなく useState でラップする。
// 制御コンポーネントは onChange のたびに親が再レンダーして初めて DOM の value が
// 更新される（親が再レンダーしないと React が DOM の value を直前の props に
// 巻き戻す）ため、実際のフォームと同じ「onChangeで即座に再レンダーする」構成でないと
// この不具合を正しく再現できない

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NumberField } from "./NumberField";

function ControlledNumberField(props: {
  initial: number;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <NumberField
      label="テスト項目"
      value={value}
      onChange={setValue}
      min={props.min}
      max={props.max}
      integer={props.integer}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("NumberField", () => {
  it("入力途中は min でクランプされない（40→25の打ち替えが成立する）", () => {
    render(<ControlledNumberField initial={40} min={18} max={94} integer />);
    const input = screen.getByLabelText("テスト項目");

    // 40 を選択して "2" と打った直後の中間状態を再現する。
    // 旧実装は onChange の中で Math.max(18, 2) を適用してしまい "18" に化けていた
    fireEvent.change(input, { target: { value: "2" } });
    expect(input).toHaveValue(2);

    // 続けて "5" を打って "25" になる（クランプされていれば "185"→94 のような
    // 桁化けが起きる）
    fireEvent.change(input, { target: { value: "25" } });
    expect(input).toHaveValue(25);
  });

  it("空欄への打ち替え（削除）が可能", () => {
    render(<ControlledNumberField initial={40} min={18} max={94} integer />);
    const input = screen.getByLabelText("テスト項目");

    fireEvent.change(input, { target: { value: "" } });
    // 空欄は0として扱われる（min にクランプされて18に化けたりしない）
    expect(input).toHaveValue(0);
  });

  it("blur すると 6.5 が整数に丸められる", () => {
    render(<ControlledNumberField initial={40} min={0} max={22} integer />);
    const input = screen.getByLabelText("テスト項目");

    // 6.5 と入力した状態で blur すると 7 に丸まる（この丸めが無いと、
    // 小数の子供の年齢が年次ループの整数年と噛み合わず教育費イベントが
    // 黙って発生しなくなる）
    fireEvent.change(input, { target: { value: "6.5" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(7);
  });

  it("blur すると範囲外の値がクランプされる", () => {
    render(<ControlledNumberField initial={40} min={0} max={22} integer />);
    const input = screen.getByLabelText("テスト項目");

    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(22);
  });
});
