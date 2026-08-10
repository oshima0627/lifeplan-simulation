import { SCENARIOS } from "@/constants/lifeplan";
import { simulateCashflow } from "./cashflow";
import type { HearingSheet, LifeplanResult } from "./types";

/**
 * 楽観・普通・悲観の3シナリオを実行してまとめる（docs/requirements.md §5.2）。
 *
 * 悲観シナリオでも資産が尽きないなら、その計画は強いと判定できる。
 * これがこのツールの中心的な出力にあたる
 */
export function runAllScenarios(sheet: HearingSheet): LifeplanResult {
  const scenarios = SCENARIOS.map((assumption) => simulateCashflow(sheet, assumption));

  return {
    scenarios,
    survivesAllScenarios: scenarios.every((s) => s.depletionAge === null),
  };
}
