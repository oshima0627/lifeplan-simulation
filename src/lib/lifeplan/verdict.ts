import type { LifeplanResult } from "./types";

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
