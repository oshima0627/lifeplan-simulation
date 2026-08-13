"use client";

import { useId } from "react";
import { withCurrent } from "@/lib/options";

/**
 * 基本情報バー専用の、幅の狭いラベル付きセレクト。
 *
 * `SelectField` と分けているのは、あちらがヒント文つきの縦積み用だから。
 * 1つの部品に compact フラグを足すと、2つのレイアウトを分岐で抱えることになる。
 *
 * ⚠️ `suffix` を持たない。バーでは横幅が最も希少な資源なので、
 * 「歳」などの単位は format で選択肢の文字列に畳み込む
 */
export function BarField({
  label,
  value,
  options,
  onChange,
  format,
  invalid,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** 真なら枠を琥珀色にする。文言はバーの下の警告行が持つ */
  invalid?: boolean;
}) {
  const id = useId();
  // ⚠️ withCurrent はここで適用する。呼び出し側に任せると、1か所忘れただけで
  // 「画面の表示と sheet の値が食い違う」状態になる（src/lib/options.ts 参照）
  const opts = withCurrent(options, value);

  return (
    <div className="flex shrink-0 snap-start flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        // 枠の色だけでは色覚特性によって伝わらない。支援技術にも同じことを伝える
        aria-invalid={invalid ? true : undefined}
        className={`w-36 rounded border px-2 py-1.5 text-sm tabular-nums focus:outline-none ${
          invalid
            ? "border-amber-500 bg-amber-50 focus:border-amber-600"
            : "border-slate-300 bg-white focus:border-slate-500"
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
    </div>
  );
}
