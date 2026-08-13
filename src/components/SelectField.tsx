"use client";

import { useId } from "react";
import { withCurrent } from "@/lib/options";

/**
 * ラベル付きの数値プルダウン。
 *
 * `NumberField`（自由入力）の置き換え。自由入力をやめたことで、
 * 範囲外の値や小数がそのまま計算エンジンへ渡る経路が構造的に消える
 * （年齢に 6.5 が入ると年次ループの整数年と噛み合わず、イベントが
 * 黙って発生しなくなる不具合が起きていた）。
 *
 * ⚠️ withCurrent はここで適用する。呼び出し側に任せると、1か所忘れただけで
 * 「画面の表示と sheet の値が食い違う」状態になる（src/lib/options.ts 参照）
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  format,
  suffix,
  hint,
  invalid,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  /** 選択肢の表示文字列。省略時は数値をそのまま出す */
  format?: (v: number) => string;
  suffix?: string;
  hint?: string;
  /** 真なら枠を琥珀色にし aria-invalid を立てる。文言は InputWarnings が持つ */
  invalid?: boolean;
}) {
  // label と select を紐づける。同じラベル名の項目が複数あっても衝突しないよう
  // React が採番するIDを使う（「第1子の年齢」「第2子の年齢」など）
  const id = useId();
  const opts = withCurrent(options, value);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <select
          id={id}
          // 枠の色だけでは色覚特性によって伝わらない。支援技術にも同じことを伝える
          aria-invalid={invalid ? true : undefined}
          className={`w-full rounded border px-3 py-2 tabular-nums focus:outline-none ${
            invalid
              ? "border-amber-500 bg-amber-50 focus:border-amber-600"
              : "border-slate-300 focus:border-slate-500"
          }`}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {format ? format(o) : o}
            </option>
          ))}
        </select>
        {suffix && <span className="shrink-0 text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}
