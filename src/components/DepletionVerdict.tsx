"use client";

import { formatCompactYen } from "@/lib/format";
import type { LifeplanResult } from "@/lib/lifeplan/types";

/**
 * 「資産が尽きる年」の判定（docs/requirements.md §5.3）。
 *
 * これはグラフの付属情報ではなく、このツールの主役として扱う。
 * 悲観シナリオでも尽きなければ、その計画は強い
 */
export function DepletionVerdict({ result }: { result: LifeplanResult }) {
  const { scenarios, survivesAllScenarios } = result;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-lg border p-4 ${
          survivesAllScenarios
            ? "border-emerald-300 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <div className="text-lg font-bold text-slate-900">
          {survivesAllScenarios
            ? "悲観シナリオでも資産は尽きません"
            : "資産が尽きるシナリオがあります"}
        </div>
        <p className="mt-1 text-sm text-slate-700">
          {survivesAllScenarios
            ? "この計画は強いと言えます。使う側に回す余地がないか、一度考えてみてください。"
            : "打ち手は5つです。生活費を下げる / 収入を増やす / 利回り・期間を見直す / 想定外の支出を防ぐ / 支出の優先順位を見直す。左のフォームを変えてその場で試せます。"}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.key} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {s.depletionAge !== null ? (
                <span className="text-red-700">{s.depletionAge}歳で尽きる</span>
              ) : s.temporaryShortfall ? (
                <span className="text-amber-700">一時的に資金不足</span>
              ) : (
                <span className="text-emerald-700">尽きない</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              95歳時点 {formatCompactYen(s.finalTotal)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
