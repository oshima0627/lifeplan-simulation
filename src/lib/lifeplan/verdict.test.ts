import { describe, expect, it } from "vitest";
import type { LifeplanResult, ScenarioResult } from "./types";
import { scenarioOutcome, verdictHeadline } from "./verdict";

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

// VerdictSummary（固定領域）と DepletionVerdict（スクロール領域）が
// 同じ分岐を別々にコピーし、文言が「一時的に不足」「一時的に資金不足」に
// 割れていた（最終レビュー指摘 F3）。ここに集約して両方から使う
describe("scenarioOutcome", () => {
  it("尽きる年齢があれば「◯歳で尽きる」", () => {
    expect(scenarioOutcome(scenario({ depletionAge: 83 }))).toBe("83歳で尽きる");
  });

  it("尽きないが一時的に不足するなら「一時的に資金不足」", () => {
    // 「一時的に不足」ではなく「一時的に資金不足」に統一する。
    // こちらがこの変更以前から本番で使われていた表現
    expect(scenarioOutcome(scenario({ temporaryShortfall: true }))).toBe("一時的に資金不足");
  });

  it("どちらでもなければ「尽きない」", () => {
    expect(scenarioOutcome(scenario({}))).toBe("尽きない");
  });
});
