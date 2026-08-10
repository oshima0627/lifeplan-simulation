/** 3桁区切りの円表記。例: 1,234,567円 */
export function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

/**
 * グラフの軸や見出し向けの短い表記。
 * 1億円以上は「1.2億円」、1万円以上は「1,234万円」、それ未満は「5,000円」
 */
export function formatCompactYen(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 100_000_000) {
    // 小数第1位まで残す（1.2億円）
    return `${sign}${(abs / 100_000_000).toFixed(1)}億円`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 10_000).toLocaleString("ja-JP")}万円`;
  }
  return `${sign}${abs.toLocaleString("ja-JP")}円`;
}
