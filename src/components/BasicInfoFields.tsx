"use client";

import { formatCompactYen } from "@/lib/format";
import { isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  LIVING_COST_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { DerivedSummary } from "./DerivedSummary";
import { SelectField } from "./SelectField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/**
 * 基本情報(Tier 1)の入力。左カラムの一番上に置く。
 *
 * ⚠️ 警告の文言はここに書かない。InputWarnings が右の固定領域で持つ。
 * 狭い画面ではこのカラムごと消えるため、警告をここに置くと見えなくなる（設計書 §4）。
 * ここでやるのは、不正な入力欄の枠を琥珀色にして aria-invalid を立てることだけ
 */
export function BasicInfoFields({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-bold text-slate-800">基本情報</h2>

      <SelectField
        label="現在の年齢"
        value={sheet.currentAge}
        options={CURRENT_AGE_OPTIONS}
        onChange={(v) => set("currentAge", v)}
        suffix="歳"
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">職業</span>
        <select
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
          value={sheet.occupation}
          onChange={(e) => set("occupation", e.target.value as Occupation)}
        >
          {(Object.keys(OCCUPATION_LABELS) as Occupation[]).map((key) => (
            <option key={key} value={key}>
              {OCCUPATION_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {/*
        ⚠️ ここから先のヒント文は HearingModal のものより短い。意図的な差であり、
        揃えるべき取り残しではない（設計書 §6.1 の表がこの短い方を指定している）
      */}
      <SelectField
        label="世帯手取り年収"
        value={sheet.householdNetIncome}
        options={INCOME_OPTIONS}
        onChange={(v) => set("householdNetIncome", v)}
        format={formatCompactYen}
        hint="配偶者がいれば合算した額"
      />

      <SelectField
        label="年間の基本生活費"
        value={sheet.annualLivingCost}
        options={LIVING_COST_OPTIONS}
        onChange={(v) => set("annualLivingCost", v)}
        format={formatCompactYen}
        hint="月30万円なら 360万円"
      />

      <SelectField
        label="現在の貯金"
        value={sheet.savings}
        options={ASSET_OPTIONS}
        onChange={(v) => set("savings", v)}
        format={formatCompactYen}
        hint="利回りがつかない現金"
      />

      <SelectField
        label="現在の投資額"
        value={sheet.investments}
        options={ASSET_OPTIONS}
        onChange={(v) => set("investments", v)}
        format={formatCompactYen}
        hint="利回りが適用される資産"
      />

      <SelectField
        label="リタイア予定年齢"
        value={sheet.retirementAge}
        options={RETIREMENT_AGE_OPTIONS}
        onChange={(v) => set("retirementAge", v)}
        suffix="歳"
        invalid={isRetirementAgeInvalid(sheet)}
      />

      <DerivedSummary sheet={sheet} />
    </section>
  );
}
