"use client";

import type { LifeplanResult } from "@/lib/lifeplan/types";
import { verdictHeadline } from "@/lib/lifeplan/verdict";

/** 1シナリオの結末を短く言い切る。固定領域に置くので1行に収める */
function outcome(s: LifeplanResult["scenarios"][number]): string {
  if (s.depletionAge !== null) return `${s.depletionAge}歳で尽きる`;
  if (s.temporaryShortfall) return "一時的に不足";
  return "尽きない";
}

/**
 * 判定を1行に圧縮したもの。画面に固定される領域に置く。
 *
 * ⚠️ 判定カード（DepletionVerdict）を丸ごと固定しないのは、
 * 年金0円の警告＋判定＋3枚のカードで縦300pxあり、グラフ360pxと合わせると
 * 固定領域が画面高を超えるため。画面高を超えた sticky は下端が永久に見えない
 * （設計書 §4.2）。打ち手の本文と95歳時点の残高はスクロール領域へ置く
 */
export function VerdictSummary({ result }: { result: LifeplanResult }) {
  const { survivesAllScenarios } = result;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2 ${
        survivesAllScenarios
          ? "border-emerald-300 bg-emerald-50"
          : "border-amber-300 bg-amber-50"
      }`}
    >
      <span className="text-sm font-bold text-slate-900">{verdictHeadline(result)}</span>
      {result.scenarios.map((s) => (
        <span
          key={s.key}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
        >
          {`${s.label} ${outcome(s)}`}
        </span>
      ))}
    </div>
  );
}
