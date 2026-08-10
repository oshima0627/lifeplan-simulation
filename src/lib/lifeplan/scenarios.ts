import { SCENARIOS } from "@/constants/lifeplan";
import { simulateCashflow } from "./cashflow";
import type { HearingSheet, LifeplanResult } from "./types";

/**
 * 楽観・普通・悲観の3シナリオを実行してまとめる（docs/requirements.md §5.2）。
 *
 * 悲観シナリオでも資産が尽きないなら、その計画は強いと判定できる。
 * これがこのツールの中心的な出力にあたる。
 *
 * 「尽きない」は depletionAge === null だけでは判定しない。一時的にマイナスへ
 * 落ちて回復した（temporaryShortfall）場合も除外する必要がある。このモデルは
 * マイナス残高に0%で無制限に借りられる前提（cashflow.ts はマイナス残高に
 * 利回りを適用しないだけで、借入という概念自体を持たない）なので、その「回復」は
 * 計画の強さの証拠にならず、モデルの副作用に過ぎない
 */
export function runAllScenarios(sheet: HearingSheet): LifeplanResult {
  const scenarios = SCENARIOS.map((assumption) => simulateCashflow(sheet, assumption));

  return {
    scenarios,
    survivesAllScenarios: scenarios.every(
      (s) => s.depletionAge === null && !s.temporaryShortfall,
    ),
  };
}
