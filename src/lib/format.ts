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

  // 万円に丸めた結果が10,000万円（＝1億円）に達するなら億表記へ切り替える。
  // 単純に abs >= 100_000_000 だけで分岐すると、99,999,999円 が四捨五入で
  // 「10,000万円」と表示され、1円しか違わない100,000,000円の「1.0億円」との
  // 境界で見た目が不連続になる（実質同じ額なのに桁の単位が飛んで見える）
  const manRounded = Math.round(abs / 10_000);
  if (manRounded >= 10_000) {
    // 小数第1位まで残す（1.2億円）
    return `${sign}${(abs / 100_000_000).toFixed(1)}億円`;
  }
  if (abs >= 10_000) {
    return `${sign}${manRounded.toLocaleString("ja-JP")}万円`;
  }
  return `${sign}${abs.toLocaleString("ja-JP")}円`;
}
