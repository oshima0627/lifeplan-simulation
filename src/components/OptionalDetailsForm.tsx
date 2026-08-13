"use client";

import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { newRowId } from "@/lib/id";
import { formatCompactYen } from "@/lib/format";
import { isEventAgeOutOfRange, isPensionStartAgeInvalid } from "@/lib/lifeplan/guards";
import type { Child, HearingSheet, LifeEvent } from "@/lib/lifeplan/types";
import {
  CHILD_AGE_OPTIONS,
  EVENT_AMOUNT_OPTIONS,
  intOptions,
  LUMP_SUM_OPTIONS,
  PENSION_OPTIONS,
  PENSION_START_AGE_OPTIONS,
} from "@/lib/options";
import { SelectField } from "./SelectField";

/**
 * 任意項目（Tier 2）の入力フォーム。左の入力カラムに置く。
 *
 * 基本情報（Tier 1）は BasicInfoFields が持つ。
 */
export function OptionalDetailsForm({
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

  // 現在の年齢をあとから引き上げると、年金受給開始年齢が現在の年齢を下回ることがある。
  // 「現在の年齢より前」を許すと入力の意図と食い違うため、ここで検知して見せる
  const pensionStartAgeInvalid = isPensionStartAgeInvalid(sheet);

  const setChild = (index: number, patch: Partial<Child>) => {
    const next = children.map((c, i) => (i === index ? { ...c, ...patch } : c));
    set("children", next);
  };

  const setEvent = (index: number, patch: Partial<LifeEvent>) => {
    const next = events.map((e, i) => (i === index ? { ...e, ...patch } : e));
    set("customEvents", next);
  };

  // ⚠️ 直下は <section> 1つだけ。以前は外側に <div className="flex flex-col gap-6">
  // があったが、単一の子を包むだけで gap-6 が効いていなかった（最終レビュー指摘 F8）ため外した
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">より詳しく（任意）</h2>
        <p className="mt-1 text-xs text-slate-500">
          入力すると精度が上がります。空欄のままでも試算できます。
        </p>
      </div>

      <SelectField
        label="退職金"
        value={sheet.retirementLumpSum ?? 0}
        options={LUMP_SUM_OPTIONS}
        onChange={(v) => set("retirementLumpSum", v)}
        format={formatCompactYen}
        hint="リタイアした年に一度だけ加算されます"
      />

      <SelectField
        label="年金の年額"
        value={sheet.pensionAnnual ?? 0}
        options={PENSION_OPTIONS}
        onChange={(v) => set("pensionAnnual", v)}
        format={formatCompactYen}
        hint="ねんきんネットの見込額を入れてください"
      />

      <div
        className={
          pensionStartAgeInvalid
            ? "flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3"
            : undefined
        }
      >
        {pensionStartAgeInvalid && (
          <p className="text-xs font-medium text-amber-700">
            ⚠️ 現在の年齢より前になっています。現在の年齢以上に修正してください
          </p>
        )}
        <SelectField
          label="年金の受給開始年齢"
          value={sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE}
          options={PENSION_START_AGE_OPTIONS}
          onChange={(v) => set("pensionStartAge", v)}
          suffix="歳"
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">子供</span>
          <button
            type="button"
            aria-label="子供を追加"
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
            key={child.id}
            className="flex items-end gap-2 rounded border border-slate-200 bg-white p-3"
          >
            <div className="flex-1">
              <SelectField
                label={`第${i + 1}子の年齢`}
                value={child.age}
                options={CHILD_AGE_OPTIONS}
                onChange={(v) => setChild(i, { age: v })}
                suffix="歳"
              />
            </div>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">進路</span>
              <select
                className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                value={child.path}
                onChange={(e) => setChild(i, { path: e.target.value as Child["path"] })}
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
          <span className="text-sm font-medium text-slate-700">大きな支出の予定</span>
          <button
            type="button"
            aria-label="大きな支出の予定を追加"
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
          const isOutOfRange = isEventAgeOutOfRange(event, sheet.currentAge);
          return (
            <div
              key={event.id}
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
                  <SelectField
                    label="発生する年齢"
                    value={event.age}
                    options={intOptions(sheet.currentAge, LIFE_EXPECTANCY_AGE)}
                    onChange={(v) => setEvent(i, { age: v })}
                    suffix="歳"
                  />
                </div>
                <div className="flex-[2]">
                  <SelectField
                    label="金額"
                    value={event.amount}
                    options={EVENT_AMOUNT_OPTIONS}
                    onChange={(v) => setEvent(i, { amount: v })}
                    format={formatCompactYen}
                  />
                </div>
                <button
                  type="button"
                  aria-label={`「${event.label || `イベント${i + 1}`}」を削除`}
                  className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                  onClick={() => set("customEvents", events.filter((_, j) => j !== i))}
                >
                  削除
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
