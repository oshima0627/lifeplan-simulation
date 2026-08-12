import type { ScenarioResult, YearRow } from "./types";

/**
 * 名目額を「今日の購買力」に直す（docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6）。
 *
 * なぜ必要か: シナリオごとにインフレ率が違うため、名目の3つの数字は
 * **それぞれ購買力の違う「円」**で書かれている。32.8億円（1%インフレの円）と
 * 7.4億円（2%インフレの円）を直接比べるのは、異なる単位の量を比べているのと同じ。
 *
 * なぜ計算エンジンを書き換えないか: 名目モデルの結果をこの式で割った値は、
 * 実質モデルで計算した値と数学的に完全に一致する。エンジンの計算仕様
 * （src/lib/lifeplan/cashflow.ts、163テストが守っている）に触れる理由が無い。
 */
export function deflate(nominalYen: number, inflationPct: number, yearsElapsed: number): number {
  return Math.round(nominalYen / (1 + inflationPct / 100) ** yearsElapsed);
}

/**
 * シナリオ結果の全金額を実質に変換する。
 *
 * ⚠️ `depletionAge` と `temporaryShortfall` は変換しない。
 * `(1+i)^n` は常に正なので `total < 0` の真偽が変わらず、割り算で値も変わらない。
 * **このツールの主指標は実質・名目のどちらで見ても同一**であり、
 * この変換のリスクは表示される金額だけに限定される。
 */
export function toRealTerms(scenario: ScenarioResult, inflationPct: number): ScenarioResult {
  const [first] = scenario.rows;
  // 先頭の年を「今日」とする。currentAge を別途受け取らずに済ませるため、
  // rows の先頭の年齢を基準にする（rows は現在年齢から始まる）
  const baseAge = first?.age ?? 0;

  const rows: YearRow[] = scenario.rows.map((r) => {
    const n = r.age - baseAge;
    return {
      ...r,
      income: deflate(r.income, inflationPct, n),
      expense: deflate(r.expense, inflationPct, n),
      balance: deflate(r.balance, inflationPct, n),
      savings: deflate(r.savings, inflationPct, n),
      investments: deflate(r.investments, inflationPct, n),
      total: deflate(r.total, inflationPct, n),
    };
  });

  const lastAge = scenario.rows.at(-1)?.age ?? baseAge;

  return {
    ...scenario,
    rows,
    finalTotal: deflate(scenario.finalTotal, inflationPct, lastAge - baseAge),
  };
}
