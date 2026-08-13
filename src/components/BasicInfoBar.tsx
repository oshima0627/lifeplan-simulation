"use client";

import { useId } from "react";
import { formatCompactYen } from "@/lib/format";
import { isPensionStartAgeInvalid, isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  LIVING_COST_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { BarField } from "./BarField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/** 年齢の選択肢を「40歳」の形にする。バーでは単位をセレクトの外に出す余裕が無い */
const asAge = (v: number) => `${v}歳`;

/**
 * 基本情報の横スクロールバー。画面に固定される領域の一番上に置く。
 *
 * ⚠️ 載せるのは8項目まで。横並びのツールバーは6〜8種類を超えると収まらなくなり、
 * あふれた分を「すべて見る」ボタンに隠すと利用者は丸ごと見落とす（Baymard の実測）。
 * 任意項目（子供・大きな支出・退職金・年金）は OptionalDetailsForm に置く。
 *
 * ⚠️ ヒント文（「配偶者がいれば合算した額」など）はここに出さない。バーの高さが倍になる。
 * ポップアップを毎回開くようにしたので、全員が少なくとも一度は目にする
 * （設計書 §5.1。片方だけを実装してはいけない）
 */
export function BasicInfoBar({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  const occupationId = useId();

  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const retirementInvalid = isRetirementAgeInvalid(sheet);
  const pensionInvalid = isPensionStartAgeInvalid(sheet);

  // 年間収支は入力ではなく導出値。押せるものと押せないものが並ぶので、
  // セレクトと同じ見た目にはしない
  const annualBalance = sheet.householdNetIncome - sheet.annualLivingCost;
  const balanceNegative = annualBalance < 0;

  return (
    <div>
      <div className="relative">
        {/*
          ⚠️ overflow-x を指定すると CSS の規定で overflow-y も auto に計算され、
          このバー自体が縦のスクロールコンテナになる。フォーカスリングが上下で
          切れないよう py で逃がしている。
          scroll-padding-inline は、キーボードで項目を移したときに
          右端のフェードの下へ項目が隠れないようにするためのもの
        */}
        <div className="flex snap-x snap-proximity gap-3 overflow-x-auto px-1 py-2 [scroll-padding-inline:2.5rem]">
          <BarField
            label="現在の年齢"
            value={sheet.currentAge}
            options={CURRENT_AGE_OPTIONS}
            onChange={(v) => set("currentAge", v)}
            format={asAge}
          />

          {/* 職業だけ値が数値ではないので BarField を使えない。見た目は揃える */}
          <div className="flex shrink-0 snap-start flex-col gap-1">
            <label htmlFor={occupationId} className="text-xs font-medium text-slate-600">
              職業
            </label>
            <select
              id={occupationId}
              className="w-36 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              value={sheet.occupation}
              onChange={(e) => set("occupation", e.target.value as Occupation)}
            >
              {(Object.keys(OCCUPATION_LABELS) as Occupation[]).map((key) => (
                <option key={key} value={key}>
                  {OCCUPATION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <BarField
            label="世帯手取り年収"
            value={sheet.householdNetIncome}
            options={INCOME_OPTIONS}
            onChange={(v) => set("householdNetIncome", v)}
            format={formatCompactYen}
          />
          <BarField
            label="年間の基本生活費"
            value={sheet.annualLivingCost}
            options={LIVING_COST_OPTIONS}
            onChange={(v) => set("annualLivingCost", v)}
            format={formatCompactYen}
          />
          <BarField
            label="現在の貯金"
            value={sheet.savings}
            options={ASSET_OPTIONS}
            onChange={(v) => set("savings", v)}
            format={formatCompactYen}
          />
          <BarField
            label="現在の投資額"
            value={sheet.investments}
            options={ASSET_OPTIONS}
            onChange={(v) => set("investments", v)}
            format={formatCompactYen}
          />
          <BarField
            label="リタイア予定年齢"
            value={sheet.retirementAge}
            options={RETIREMENT_AGE_OPTIONS}
            onChange={(v) => set("retirementAge", v)}
            format={asAge}
            invalid={retirementInvalid}
          />

          <div className="flex shrink-0 snap-start flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">年間収支</span>
            <span
              className={`inline-flex w-36 items-center rounded border px-2 py-1.5 text-sm font-bold tabular-nums ${
                balanceNegative
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-slate-200 bg-slate-100 text-slate-900"
              }`}
            >
              {formatCompactYen(annualBalance)}
            </span>
          </div>
        </div>

        {/*
          続きがあることを示すフェード。
          ⚠️ 矢印でのページ送りは付けない。それは Carousel であって別の部品になる
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-slate-50"
        />
      </div>

      {(retirementInvalid || pensionInvalid) && (
        // ⚠️ role="alert" は使わない。値を変えるたびに読み上げが割り込む。
        // 助言は role="status"。role="banner" はサイトヘッダのランドマークなので論外
        <div
          role="status"
          className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
        >
          {retirementInvalid && (
            <p>
              ⚠️ リタイア予定年齢が現在の年齢より前になっています。この状態では
              給与収入が全期間0円として試算されます
            </p>
          )}
          {pensionInvalid && (
            <p>⚠️ 年金の受給開始年齢が現在の年齢より前になっています</p>
          )}
        </div>
      )}
    </div>
  );
}
