// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LifeplanResult, ScenarioResult } from "@/lib/lifeplan/types";
import { VerdictSummary } from "./VerdictSummary";

afterEach(() => {
  cleanup();
});

function scenario(over: Partial<ScenarioResult>): ScenarioResult {
  return {
    key: "baseline",
    label: "普通",
    rows: [],
    depletionAge: null,
    temporaryShortfall: false,
    finalTotal: 0,
    ...over,
  };
}

describe("VerdictSummary", () => {
  it("見出しを出す", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ depletionAge: 83 })],
      survivesAllScenarios: false,
    };
    render(<VerdictSummary result={result} />);
    expect(screen.getByText("資産が尽きるシナリオがあります")).toBeInTheDocument();
  });

  it("シナリオごとに「ラベル + 結末」を1つずつ出す", () => {
    const result: LifeplanResult = {
      scenarios: [
        scenario({ key: "optimistic", label: "楽観" }),
        scenario({ key: "baseline", label: "普通", depletionAge: 83 }),
        scenario({ key: "pessimistic", label: "悲観", temporaryShortfall: true }),
      ],
      survivesAllScenarios: false,
    };
    render(<VerdictSummary result={result} />);
    expect(screen.getByText("楽観 尽きない")).toBeInTheDocument();
    expect(screen.getByText("普通 83歳で尽きる")).toBeInTheDocument();
    expect(screen.getByText("悲観 一時的に不足")).toBeInTheDocument();
  });
});
