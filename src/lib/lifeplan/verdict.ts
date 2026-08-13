import type { LifeplanResult, ScenarioResult } from "./types";

/**
 * 判定の見出し。
 *
 * ⚠️ 分岐をここに集約する。固定領域の VerdictSummary と、スクロール領域の
 * DepletionVerdict が同じ判定を別々に書くと、片方だけ直して他方に
 * 反映し忘れる。guards.ts が作られたのと同じ理由（最終レビュー指摘 C1）。
 *
 * survivesAllScenarios は「尽きない」かつ「一時的な資金不足もない」を要求するので、
 * false になる理由は2通りある。実際に尽きるのか、尽きはしないが途中で
 * マイナスへ落ちるのかで文言を変える
 */
export function verdictHeadline(result: LifeplanResult): string {
  if (result.survivesAllScenarios) return "悲観シナリオでも資産は尽きません";
  const anyDepletes = result.scenarios.some((s) => s.depletionAge !== null);
  return anyDepletes
    ? "資産が尽きるシナリオがあります"
    : "尽きはしませんが、一時的に資金不足になるシナリオがあります";
}

/**
 * 1シナリオの結末を短い文言にする。
 *
 * verdictHeadline と同じ理由でここに集約する。集約する前は VerdictSummary
 * （固定領域）と DepletionVerdict（スクロール領域）が同じ分岐をそれぞれ
 * コピーしており、「一時的に不足」「一時的に資金不足」に文言が割れていた
 * （最終レビュー指摘 F3）。文言は「一時的に資金不足」に統一する——こちらが
 * この変更より前から本番で使われていた表現で、変えると既存のテストや
 * 利用者の記憶に不要な影響が出る。
 *
 * 色は用途（バッジ／カード）によって呼び出し側で変わるため、ここでは
 * 文字列だけを返し、色は呼び出し側が持つ
 */
export function scenarioOutcome(scenario: ScenarioResult): string {
  if (scenario.depletionAge !== null) return `${scenario.depletionAge}歳で尽きる`;
  if (scenario.temporaryShortfall) return "一時的に資金不足";
  return "尽きない";
}
