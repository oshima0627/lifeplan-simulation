import { describe, expect, it } from "vitest";
import type { LifeplanResult, ScenarioResult } from "./types";
import { verdictHeadline } from "./verdict";

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

describe("verdictHeadline", () => {
  it("すべてのシナリオで尽きなければ「尽きません」", () => {
    const result: LifeplanResult = { scenarios: [scenario({})], survivesAllScenarios: true };
    expect(verdictHeadline(result)).toBe("悲観シナリオでも資産は尽きません");
  });

  it("尽きるシナリオがあれば「尽きるシナリオがあります」", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ depletionAge: 83 })],
      survivesAllScenarios: false,
    };
    expect(verdictHeadline(result)).toBe("資産が尽きるシナリオがあります");
  });

  it("尽きはしないが一時的に不足するなら、その旨の見出し", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ temporaryShortfall: true })],
      survivesAllScenarios: false,
    };
    expect(verdictHeadline(result)).toBe(
      "尽きはしませんが、一時的に資金不足になるシナリオがあります",
    );
  });
});
