// @vitest-environment jsdom
//
// select の option 構成と onChange の型を検証するので jsdom が要る。
// 環境指定の作法は src/components/OptionalDetailsForm.test.tsx に合わせている

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactYen } from "@/lib/format";
import { SelectField } from "./SelectField";

afterEach(() => {
  cleanup();
});

describe("SelectField", () => {
  it("選択すると文字列ではなく数値で通知する", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="年収"
        value={100}
        options={[100, 200, 300]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("年収"), { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith(200);
  });

  it("選択肢に無い現在値でも、その値が選択された状態になる", () => {
    // 旧フォーム（自由入力）で保存された刻み外の値を想定
    render(
      <SelectField
        label="年収"
        value={6_123_456}
        options={[1_000_000, 10_000_000]}
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText("年収") as HTMLSelectElement;
    expect(select.value).toBe("6123456");
    expect(select.options).toHaveLength(3);
  });

  it("format を渡すと表示文字列に使われる", () => {
    render(
      <SelectField
        label="年収"
        value={6_000_000}
        options={[6_000_000]}
        onChange={() => {}}
        format={formatCompactYen}
      />,
    );
    expect(screen.getByRole("option", { name: "600万円" })).toBeInTheDocument();
  });

  it("hint を表示する", () => {
    render(
      <SelectField
        label="年収"
        value={100}
        options={[100]}
        onChange={() => {}}
        hint="配偶者がいれば合算した額"
      />,
    );
    expect(screen.getByText("配偶者がいれば合算した額")).toBeInTheDocument();
  });
});
