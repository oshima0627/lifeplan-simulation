"use client";

import { formatYen } from "@/lib/format";
import type { HearingSheet } from "@/lib/lifeplan/types";

/**
 * 導出値を見せるパネル（docs/requirements.md §6）。
 *
 * 年間収支は入力項目ではなく「手取り年収 − 基本生活費」の計算結果。
 * ユーザーが自分の感覚と照合でき、乖離が大きければ
 * 生活費の申告が実態とずれている合図になる
 */
export function DerivedSummary({ sheet }: { sheet: HearingSheet }) {
  const annualBalance = sheet.householdNetIncome - sheet.annualLivingCost;
  const monthly = Math.round(annualBalance / 12);
  const isNegative = annualBalance < 0;

  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isNegative ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="font-medium text-slate-700">年間収支（自動計算）</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          isNegative ? "text-red-700" : "text-slate-900"
        }`}
      >
        {formatYen(annualBalance)}
      </div>
      <div className="mt-1 text-slate-600">月あたり {formatYen(monthly)}</div>
      <p className="mt-2 text-xs text-slate-500">
        {isNegative
          ? "支出が収入を上回っています。生活費の入力が実態と合っているか確認してください。"
          : "これは基本生活費だけを差し引いた金額で、教育費やライフイベント費は含みません。実感と大きくずれていれば、生活費の入力を見直してください。"}
      </p>
    </div>
  );
}
