"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { formatCompactYen } from "@/lib/format";
import { newRowId } from "@/lib/id";
import {
  isEventAgeOutOfRange,
  isPensionStartAgeInvalid,
  isRetirementAgeInvalid,
} from "@/lib/lifeplan/guards";
import type { Child, HearingSheet, LifeEvent, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CHILD_AGE_OPTIONS,
  CURRENT_AGE_OPTIONS,
  EVENT_AMOUNT_OPTIONS,
  INCOME_OPTIONS,
  intOptions,
  LIVING_COST_OPTIONS,
  LUMP_SUM_OPTIONS,
  PENSION_OPTIONS,
  PENSION_START_AGE_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { SelectField } from "./SelectField";
import { Steps } from "./Steps";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/** ステップの見出し。index がそのままステップ番号になる */
const STEP_TITLES = [
  "あなたのこと",
  "お金の流れ",
  "いまの資産",
  "家族",
  "老後",
  "大きな支出",
] as const;

/** ここから先はスキップできる（Tier 2）。0〜2 は必須（Tier 1） */
const FIRST_OPTIONAL_STEP = 3;

/**
 * ステップ式のヒアリングモーダル。
 *
 * 初回訪問で自動的に開き、何を入れればいいか分からない人を最後まで導く。
 * 2回目以降の微調整は横並びの HearingForm で行う（即座に再計算される体験を
 * 失わせないため。docs/requirements.md §6）。
 *
 * <dialog> を使わないのは、jsdom の showModal() サポートが環境依存で、
 * テストが実装ではなく環境の都合で落ちるため
 */
export function HearingModal({
  sheet,
  onChange,
  open,
  onClose,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 開く直前にフォーカスがあった要素。閉じたらここへ返す
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 開き直したときは最初から始める。前回の途中位置を覚えていると、
  // 「入力をやり直す」を押したのに5ステップ目が出る、という挙動になる
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setStep(0);
  }, [open]);

  // 開いている間だけ、閉じたときの戻り先を覚えておく。
  // クリーンアップで返すので、閉じ方（✕・Escape・この内容で見る）を問わず1か所で済む。
  //
  // ⚠️ 下の「✕ボタンへフォーカスを移す」エフェクトより先に実行される必要がある。
  // 後だと、captureする時点で既にフォーカスが✕ボタンに移っており、
  // 呼び出し元の要素を記録できない
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // 開いたときにモーダル内の最初の操作要素（✕ボタン）へフォーカスを移す
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  // Escape で閉じる。加えて Tab をモーダル内で循環させる。
  //
  // ⚠️ モーダルを毎回開くようにしたので、これは全利用者の必経路になった。
  // キーボードだけで操作する人がモーダルの外へ抜けると、背後のバーを
  // 操作できてしまい、どこにいるのか分からなくなる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const children = sheet.children ?? [];
  const events = sheet.customEvents ?? [];

  const setChild = (index: number, patch: Partial<Child>) =>
    set("children", children.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const setEvent = (index: number, patch: Partial<LifeEvent>) =>
    set("customEvents", events.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const isLast = step === STEP_TITLES.length - 1;
  const canSkip = step >= FIRST_OPTIONAL_STEP;

  const advance = () => (isLast ? onClose() : setStep(step + 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={STEP_TITLES[step]}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <Steps titles={STEP_TITLES} current={step} onSelect={setStep} />
            <h2 className="mt-1 text-lg font-bold text-slate-900">{STEP_TITLES[step]}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="閉じる"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {step === 0 && (
            <>
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
              <div
                className={
                  isRetirementAgeInvalid(sheet)
                    ? "flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3"
                    : undefined
                }
              >
                {isRetirementAgeInvalid(sheet) && (
                  <p className="text-xs font-medium text-amber-700">
                    ⚠️ 現在の年齢より前になっています。この状態では給与収入が全期間0円として
                    試算されます。現在の年齢以上に修正してください
                  </p>
                )}
                <SelectField
                  label="リタイア予定年齢"
                  value={sheet.retirementAge}
                  options={RETIREMENT_AGE_OPTIONS}
                  onChange={(v) => set("retirementAge", v)}
                  suffix="歳"
                  hint="働くのをやめる予定の年齢。決めていなければ65歳のままで構いません"
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <SelectField
                label="世帯手取り年収"
                value={sheet.householdNetIncome}
                options={INCOME_OPTIONS}
                onChange={(v) => set("householdNetIncome", v)}
                format={formatCompactYen}
                hint="配偶者がいれば合算した額。源泉徴収票の「支払金額」ではなく、実際に振り込まれる額です"
              />
              <SelectField
                label="年間の基本生活費"
                value={sheet.annualLivingCost}
                options={LIVING_COST_OPTIONS}
                onChange={(v) => set("annualLivingCost", v)}
                format={formatCompactYen}
                hint="わからなければ「手取り年収 − 1年間で増えた貯金額」で概算できます"
              />
            </>
          )}

          {step === 2 && (
            <>
              <SelectField
                label="現在の貯金"
                value={sheet.savings}
                options={ASSET_OPTIONS}
                onChange={(v) => set("savings", v)}
                format={formatCompactYen}
                hint="普通預金・定期預金など、利回りがつかないお金"
              />
              <SelectField
                label="現在の投資額"
                value={sheet.investments}
                options={ASSET_OPTIONS}
                onChange={(v) => set("investments", v)}
                format={formatCompactYen}
                hint="NISA・iDeCo・投資信託など、利回りが適用される資産の時価"
              />
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-slate-500">
                登録すると、進学時期に合わせた教育費が自動で支出に計上されます。
                お子さんがいなければスキップしてください。
              </p>
              {children.map((child, i) => (
                <div
                  key={child.id}
                  className="flex items-end gap-2 rounded border border-slate-200 p-3"
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
              <button
                type="button"
                aria-label="子供を追加"
                className="self-start rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                onClick={() =>
                  set("children", [...children, { id: newRowId(), age: 0, path: "public" }])
                }
              >
                子供を追加
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <SelectField
                label="退職金"
                value={sheet.retirementLumpSum ?? 0}
                options={LUMP_SUM_OPTIONS}
                onChange={(v) => set("retirementLumpSum", v)}
                format={formatCompactYen}
                hint="リタイアした年に一度だけ加算されます。就業規則の退職金規程で確認できます"
              />
              <SelectField
                label="年金の年額"
                value={sheet.pensionAnnual ?? 0}
                options={PENSION_OPTIONS}
                onChange={(v) => set("pensionAnnual", v)}
                format={formatCompactYen}
                hint="「ねんきんネット」で見込額を確認できます。0円のままだと年金が一切ない前提で試算されます"
              />
              <div
                className={
                  isPensionStartAgeInvalid(sheet)
                    ? "flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3"
                    : undefined
                }
              >
                {isPensionStartAgeInvalid(sheet) && (
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
                  hint="上の金額は65歳から受け取る場合の額として扱います"
                />
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-xs text-slate-500">
                住宅購入・車の買い替え・リフォームなど、特定の年にまとまって出ていくお金を登録できます。
                予定がなければスキップしてください。
              </p>
              {events.map((event, i) => {
                const outOfRange = isEventAgeOutOfRange(event, sheet.currentAge);
                return (
                <div
                  key={event.id}
                  className={`flex flex-col gap-2 rounded border p-3 ${
                    outOfRange ? "border-amber-400 bg-amber-50" : "border-slate-200"
                  }`}
                >
                  {outOfRange && (
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
                  <SelectField
                    label="発生する年齢"
                    value={event.age}
                    options={intOptions(sheet.currentAge, LIFE_EXPECTANCY_AGE)}
                    onChange={(v) => setEvent(i, { age: v })}
                    suffix="歳"
                  />
                  <SelectField
                    label="金額"
                    value={event.amount}
                    options={EVENT_AMOUNT_OPTIONS}
                    onChange={(v) => setEvent(i, { amount: v })}
                    format={formatCompactYen}
                  />
                  <button
                    type="button"
                    aria-label={`「${event.label || `イベント${i + 1}`}」を削除`}
                    className="self-start rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                    onClick={() => set("customEvents", events.filter((_, j) => j !== i))}
                  >
                    削除
                  </button>
                </div>
                );
              })}
              <button
                type="button"
                aria-label="大きな支出の予定を追加"
                className="self-start rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                onClick={() =>
                  set("customEvents", [
                    ...events,
                    {
                      id: newRowId(),
                      age: Math.min(sheet.currentAge + 5, LIFE_EXPECTANCY_AGE),
                      amount: 30_000_000,
                      label: "住宅購入",
                    },
                  ])
                }
              >
                大きな支出の予定を追加
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <div>
            {step > 0 && (
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
                onClick={() => setStep(step - 1)}
              >
                戻る
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {/*
              毎回開く以上、再訪者が抜ける道が要る。
              ✕ と Escape だけでは「閉じ方が分からない」人が6ステップ押し切ることになる
            */}
            <button
              type="button"
              className="rounded px-3 py-2 text-sm text-slate-600 underline hover:text-slate-900"
              onClick={onClose}
            >
              この内容で見る
            </button>
            {canSkip && (
              <button
                type="button"
                className="rounded px-4 py-2 text-sm text-slate-500 underline hover:text-slate-800"
                onClick={advance}
              >
                スキップ
              </button>
            )}
            <button
              type="button"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={advance}
            >
              {isLast ? "結果を見る" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
