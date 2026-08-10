"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactYen } from "@/lib/format";
import type { LifeplanResult, ScenarioKey } from "@/lib/lifeplan/types";

/** シナリオごとの線の色 */
const COLORS: Record<ScenarioKey, string> = {
  optimistic: "#0ea5e9",
  baseline: "#334155",
  pessimistic: "#dc2626",
};

/**
 * 3シナリオの総資産推移を重ねて描く（docs/requirements.md §5.3）。
 *
 * 0円の水平線を引くことで「どこで水面下に入るか」が一目で分かるようにする
 */
export function CashflowChart({ result }: { result: LifeplanResult }) {
  const [first] = result.scenarios;
  if (!first) return null;

  // recharts は「1行 = 1つのX座標」の形を求めるので、年齢をキーに横に並べ直す
  const data = first.rows.map((row, i) => {
    const point: Record<string, number> = { age: row.age };
    for (const s of result.scenarios) {
      point[s.key] = s.rows[i].total;
    }
    return point;
  });

  return (
    <div className="h-[360px] w-full rounded-lg border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => `${v}歳`}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            width={70}
            tickFormatter={(v: number) => formatCompactYen(v)}
          />
          {/*
            recharts の Tooltip は formatter/labelFormatter の引数を
            ValueType | undefined / ReactNode という緩い型で渡してくる。
            number / string と注釈すると型エラーになるので、
            受けは型注釈なしにして中で変換する
          */}
          <Tooltip
            formatter={(value, name) => [formatCompactYen(Number(value ?? 0)), String(name)]}
            labelFormatter={(label) => `${String(label)}歳`}
          />
          <Legend />
          {/* 資産ゼロの線。ここを下回った時点で計画は破綻している */}
          <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.5} />
          {result.scenarios.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={COLORS[s.key]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
