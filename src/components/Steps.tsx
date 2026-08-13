"use client";

/**
 * ステップ表示。
 *
 * ⚠️ aria-current="step" は現在の段だけに付ける。2つ以上に付けると
 * 読み上げの位置が壊れる。
 *
 * ⚠️ 状態は current という単一の数値から導出する。完了・現在・未到達を
 * 別々に持つと、片方だけ更新して食い違う。
 *
 * 段を押せるのは、ポップアップを毎回開くようにしたから。
 * 「年収だけ直したい」再訪者に「次へ」を4回押させる設計は成立しない
 */
export function Steps({
  titles,
  current,
  onSelect,
}: {
  titles: readonly string[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {titles.map((title, i) => {
        const done = i < current;
        const isCurrent = i === current;
        return (
          <li key={title} className="flex items-center">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-slate-100 ${
                isCurrent ? "font-bold text-slate-900" : "text-slate-500"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                  done
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isCurrent
                      ? "border-slate-900 text-slate-900"
                      : "border-slate-300 text-slate-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {title}
            </button>
            {i < titles.length - 1 && (
              <span aria-hidden className="h-px w-3 bg-slate-300" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
