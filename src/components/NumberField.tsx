"use client";

/**
 * ラベル付きの数値入力。空欄は0として扱い、NaN を上位に流さない。
 *
 * `min`/`max`/`integer` は範囲外の値がそのまま計算エンジンに渡るのを防ぐための
 * コード側バリデーション（docs/requirements.md §3.2 — Structured Outputs の
 * JSON Schema は minimum/maximum をサポートしないため、範囲検証はコード側で行う）。
 * 年齢に小数（例: 6.5歳）が入ると年次ループの整数年と噛み合わず、
 * イベントが黙って発生しなくなる不具合につながるため、年齢系フィールドは
 * 必ず `integer` を指定すること
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  hint,
  min,
  max,
  integer,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  hint?: string;
  /** この値未満は丸め込む */
  min?: number;
  /** この値超過は丸め込む */
  max?: number;
  /** true なら整数に丸める（小数第1位以下を四捨五入） */
  integer?: boolean;
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
          min={min}
          max={max}
          onChange={(e) => {
            let next = Number(e.target.value);
            if (!Number.isFinite(next)) next = 0;
            if (integer) next = Math.round(next);
            if (min !== undefined) next = Math.max(min, next);
            if (max !== undefined) next = Math.min(max, next);
            onChange(next);
          }}
        />
        {suffix && <span className="shrink-0 text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
