"use client";

import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { newRowId } from "@/lib/id";
import type { Child, HearingSheet, LifeEvent, Occupation } from "@/lib/lifeplan/types";
import { DerivedSummary } from "./DerivedSummary";
import { NumberField } from "./NumberField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/**
 * ヒアリング項目の入力フォーム。
 * Tier 1（必須）と Tier 2（任意）を視覚的に分ける（docs/requirements.md §4）
 */
export function HearingForm({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  // 1項目だけ差し替えて上位に返す
  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const children = sheet.children ?? [];
  const events = sheet.customEvents ?? [];

  // 現在の年齢をあとから引き上げると、リタイア予定年齢・年金受給開始年齢が
  // 現在の年齢を下回ることがある。これはイベントの範囲外と違って「試算に反映されない」
  // のではなく、cashflow.ts の `age < retirementAge` 判定が全期間 false になり、
  // 給与収入が黙って0円として試算され続けてしまう。年金受給開始年齢も同様に
  // 「現在の年齢より前」を許すと入力の意図と食い違うため、ここで検知して見せる
  const isRetirementAgeInvalid = sheet.retirementAge < sheet.currentAge;
  const effectivePensionStartAge = sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE;
  const isPensionStartAgeInvalid = effectivePensionStartAge < sheet.currentAge;

  const setChild = (index: number, patch: Partial<Child>) => {
    const next = children.map((c, i) => (i === index ? { ...c, ...patch } : c));
    set("children", next);
  };

  const setEvent = (index: number, patch: Partial<LifeEvent>) => {
    const next = events.map((e, i) => (i === index ? { ...e, ...patch } : e));
    set("customEvents", next);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-bold text-slate-800">基本情報</h2>

        <NumberField
          label="現在の年齢"
          value={sheet.currentAge}
          onChange={(v) => set("currentAge", v)}
          suffix="歳"
          integer
          min={18}
          max={LIFE_EXPECTANCY_AGE - 1}
          hint="18〜94歳の範囲で入力してください"
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

        <NumberField
          label="世帯手取り年収"
          value={sheet.householdNetIncome}
          onChange={(v) => set("householdNetIncome", v)}
          suffix="円"
          step={100_000}
          hint="配偶者がいれば合算した額"
        />

        <NumberField
          label="年間の基本生活費"
          value={sheet.annualLivingCost}
          onChange={(v) => set("annualLivingCost", v)}
          suffix="円"
          step={100_000}
          hint="月30万円なら 3,600,000"
        />

        <NumberField
          label="現在の貯金"
          value={sheet.savings}
          onChange={(v) => set("savings", v)}
          suffix="円"
          step={100_000}
          hint="利回りがつかない現金"
        />

        <NumberField
          label="現在の投資額"
          value={sheet.investments}
          onChange={(v) => set("investments", v)}
          suffix="円"
          step={100_000}
          hint="利回りが適用される資産"
        />

        <div
          className={
            isRetirementAgeInvalid
              ? "flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3"
              : undefined
          }
        >
          {isRetirementAgeInvalid && (
            <p className="text-xs font-medium text-amber-700">
              ⚠️ 現在の年齢より前になっています。この状態では給与収入が全期間0円として
              試算されます。現在の年齢以上に修正してください
            </p>
          )}
          <NumberField
            label="リタイア予定年齢"
            value={sheet.retirementAge}
            onChange={(v) => set("retirementAge", v)}
            suffix="歳"
            integer
            min={sheet.currentAge}
            max={LIFE_EXPECTANCY_AGE}
          />
        </div>

        <DerivedSummary sheet={sheet} />
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div>
          <h2 className="text-base font-bold text-slate-800">より詳しく（任意）</h2>
          <p className="mt-1 text-xs text-slate-500">
            入力すると精度が上がります。空欄のままでも試算できます。
          </p>
        </div>

        <NumberField
          label="退職金"
          value={sheet.retirementLumpSum ?? 0}
          onChange={(v) => set("retirementLumpSum", v)}
          suffix="円"
          step={1_000_000}
          hint="リタイアした年に一度だけ加算されます"
        />

        <NumberField
          label="年金の年額"
          value={sheet.pensionAnnual ?? 0}
          onChange={(v) => set("pensionAnnual", v)}
          suffix="円"
          step={100_000}
          hint="ねんきんネットの見込額を入れてください"
        />

        <div
          className={
            isPensionStartAgeInvalid
              ? "flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3"
              : undefined
          }
        >
          {isPensionStartAgeInvalid && (
            <p className="text-xs font-medium text-amber-700">
              ⚠️ 現在の年齢より前になっています。現在の年齢以上に修正してください
            </p>
          )}
          <NumberField
            label="年金の受給開始年齢"
            value={sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE}
            onChange={(v) => set("pensionStartAge", v)}
            suffix="歳"
            integer
            min={sheet.currentAge}
            max={LIFE_EXPECTANCY_AGE}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">子供</span>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              onClick={() =>
                set("children", [...children, { id: newRowId(), age: 0, path: "public" }])
              }
            >
              追加
            </button>
          </div>

          {children.length === 0 && (
            <p className="text-xs text-slate-500">
              追加すると、進学時期に合わせた教育費が自動で支出に計上されます。
            </p>
          )}

          {children.map((child, i) => (
            <div
              key={i}
              className="flex items-end gap-2 rounded border border-slate-200 bg-white p-3"
            >
              <div className="flex-1">
                <NumberField
                  label={`第${i + 1}子の年齢`}
                  value={child.age}
                  onChange={(v) => setChild(i, { age: v })}
                  suffix="歳"
                  integer
                  min={0}
                  max={22}
                />
              </div>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">進路</span>
                <select
                  className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                  value={child.path}
                  onChange={(e) =>
                    setChild(i, { path: e.target.value as Child["path"] })
                  }
                >
                  <option value="public">公立</option>
                  <option value="private">私立</option>
                </select>
              </label>
              <button
                type="button"
                aria-label={`第${i + 1}子を削除`}
                className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                onClick={() => set("children", children.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              大きな支出の予定
            </span>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              onClick={() =>
                set("customEvents", [
                  ...events,
                  {
                    id: newRowId(),
                    // currentAge をあとから上げても既定値が範囲外にならないよう、
                    // 上限（95歳）でクランプしておく
                    age: Math.min(sheet.currentAge + 5, LIFE_EXPECTANCY_AGE),
                    amount: 30_000_000,
                    label: "住宅購入",
                  },
                ])
              }
            >
              追加
            </button>
          </div>

          {events.length === 0 && (
            <p className="text-xs text-slate-500">
              住宅購入・車の買い替え・リフォームなど、特定の年にまとまって出ていくお金を登録できます。
            </p>
          )}

          {events.map((event, i) => {
            // 現在の年齢をあとから引き上げると、すでに登録済みのイベントが
            // 試算範囲外になることがある。その場合は計算エンジンが黙って無視するので、
            // ここで検知してユーザーに見えるようにする
            const isOutOfRange = event.age < sheet.currentAge || event.age > LIFE_EXPECTANCY_AGE;
            return (
              <div
                key={i}
                className={`flex flex-col gap-2 rounded border p-3 ${
                  isOutOfRange ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
                }`}
              >
                {isOutOfRange && (
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ 現在の年齢〜95歳の範囲外のため、この項目は試算に反映されていません
                  </p>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">内容</span>
                  <input
                    type="text"
                    className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                    value={event.label}
                    onChange={(e) => setEvent(i, { label: e.target.value })}
                  />
                </label>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <NumberField
                      label="発生する年齢"
                      value={event.age}
                      onChange={(v) => setEvent(i, { age: v })}
                      suffix="歳"
                      integer
                      min={sheet.currentAge}
                      max={LIFE_EXPECTANCY_AGE}
                    />
                  </div>
                  <div className="flex-[2]">
                    <NumberField
                      label="金額"
                      value={event.amount}
                      onChange={(v) => setEvent(i, { amount: v })}
                      suffix="円"
                      step={1_000_000}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`「${event.label || `イベント${i + 1}`}」を削除`}
                    className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                    onClick={() =>
                      set("customEvents", events.filter((_, j) => j !== i))
                    }
                  >
                    削除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
