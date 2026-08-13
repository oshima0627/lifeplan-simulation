// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Steps } from "./Steps";

afterEach(() => {
  cleanup();
});

const TITLES = ["あなたのこと", "お金の流れ", "いまの資産"] as const;

describe("Steps", () => {
  it("段の数だけボタンが出る", () => {
    render(<Steps titles={TITLES} current={0} onSelect={() => {}} />);
    for (const t of TITLES) {
      expect(screen.getByRole("button", { name: new RegExp(t) })).toBeInTheDocument();
    }
  });

  it("aria-current=step が付くのはちょうど1つ", () => {
    const { container } = render(<Steps titles={TITLES} current={1} onSelect={() => {}} />);
    // 2つ以上に付けると読み上げ位置が壊れる
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("aria-current=step が付くのは現在の段", () => {
    render(<Steps titles={TITLES} current={1} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /お金の流れ/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("押すとその段の番号を返す", () => {
    let picked = -1;
    render(<Steps titles={TITLES} current={0} onSelect={(i) => (picked = i)} />);
    fireEvent.click(screen.getByRole("button", { name: /いまの資産/ }));
    expect(picked).toBe(2);
  });

  it("完了した段は番号ではなくチェックを出す", () => {
    render(<Steps titles={TITLES} current={2} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /あなたのこと/ })).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: /いまの資産/ })).toHaveTextContent("3");
  });
});
