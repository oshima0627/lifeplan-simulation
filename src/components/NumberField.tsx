"use client";

/** ラベル付きの数値入力。空欄は0として扱い、NaN を上位に流さない */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="w-full rounded border border-slate-300 px-3 py-2 text-right tabular-nums focus:border-slate-500 focus:outline-none"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
        {suffix && <span className="shrink-0 text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
