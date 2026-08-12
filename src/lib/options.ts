/**
 * プルダウンの選択肢。
 *
 * 帯（「400〜500万円」）ではなく細かい刻みにするのは、帯の中央値で計算すると
 * 年収50万円のズレが95歳まで積み上がり、試算の信頼性が落ちるため
 * （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.2）
 */

/** 円単位の選択肢。max を超える値は含めない */
export function moneyOptions(minYen: number, maxYen: number, stepYen: number): number[] {
  const out: number[] = [];
  for (let v = minYen; v <= maxYen; v += stepYen) out.push(v);
  return out;
}

/** 両端を含む整数の連番 */
export function intOptions(min: number, max: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v++) out.push(v);
  return out;
}

/**
 * 現在値が選択肢に無ければ昇順を保って差し込む。
 *
 * ⚠️ これが無いと保存済みデータで表示と実値が食い違う。
 * 旧フォームは自由入力だったので、既存ユーザーの localStorage には
 * 刻みに乗らない値（例: 6,123,456円）が入っている。`<select>` の value が
 * 選択肢に無いとブラウザは先頭を表示するが、sheet の値は変わらない。
 * 「画面には100万円と出ているのにグラフは612万円で計算されている」状態になる
 */
export function withCurrent(options: number[], current: number): number[] {
  if (!Number.isFinite(current)) return options;
  if (options.includes(current)) return options;
  return [...options, current].sort((a, b) => a - b);
}

// --- 各項目の選択肢（設計書 §4.2） ---

export const INCOME_OPTIONS = moneyOptions(1_000_000, 30_000_000, 100_000);
export const LIVING_COST_OPTIONS = moneyOptions(600_000, 12_000_000, 100_000);
export const ASSET_OPTIONS = moneyOptions(0, 100_000_000, 500_000);
export const LUMP_SUM_OPTIONS = moneyOptions(0, 50_000_000, 500_000);
export const PENSION_OPTIONS = moneyOptions(0, 5_000_000, 50_000);
export const EVENT_AMOUNT_OPTIONS = moneyOptions(0, 100_000_000, 500_000);

export const CURRENT_AGE_OPTIONS = intOptions(18, 80);
export const RETIREMENT_AGE_OPTIONS = intOptions(45, 80);
export const PENSION_START_AGE_OPTIONS = intOptions(60, 75);
export const CHILD_AGE_OPTIONS = intOptions(0, 22);
