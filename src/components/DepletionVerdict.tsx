"use client";

import { formatCompactYen } from "@/lib/format";
import type { HearingSheet, LifeplanResult } from "@/lib/lifeplan/types";
import { scenarioOutcome, verdictHeadline } from "@/lib/lifeplan/verdict";

/**
 * 「資産が尽きる年」の判定（docs/requirements.md §5.3）。
 *
 * これはグラフの付属情報ではなく、このツールの主役として扱う。
 * 悲観シナリオでも尽きなければ、その計画は強い
 */
export function DepletionVerdict({
  result,
  sheet,
}: {
  result: LifeplanResult;
  sheet: HearingSheet;
}) {
  const { scenarios, survivesAllScenarios } = result;
  const hasNoPension = (sheet.pensionAnnual ?? 0) === 0;

  // survivesAllScenarios は「尽きない」かつ「一時的な資金不足もない」を要求する
  // （src/lib/lifeplan/scenarios.ts 参照）。false になる理由は2通りあるので、
  // 見出しの文言もそれに応じて分ける:
  // - 実際に尽きるシナリオがある（赤）
  // - どのシナリオも尽きはしないが、一時的にマイナスへ落ちるものがある（黄）。
  //   このモデルはマイナス残高を0%で無制限に借りられる前提を置いているだけなので、
  //   その「回復」を「計画は強い」の根拠にはできない
  const anyDepletes = scenarios.some((s) => s.depletionAge !== null);

  return (
    <div className="flex flex-col gap-3">
      {hasNoPension && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠️ 年金の年額が0円のまま試算されています。これは「公的年金を一切受け取らない」という
          仮定であり、多くの方にとって実態と異なります。金額を勝手に見積もることはできないため、
          お手数ですが
          <a
            href="https://www.nenkin.go.jp/n_net/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            ねんきんネット
          </a>
          で見込額をご確認のうえ入力してください。
        </div>
      )}

      <div
        className={`rounded-lg border p-4 ${
          survivesAllScenarios
            ? "border-emerald-300 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <div className="text-lg font-bold text-slate-900">{verdictHeadline(result)}</div>
        <p className="mt-1 text-sm text-slate-700">
          {survivesAllScenarios
            ? "この計画は強いと言えます。使う側に回す余地がないか、一度考えてみてください。"
            : anyDepletes
              ? "打ち手は5つです。生活費を下げる / 収入を増やす / 利回り・期間を見直す / 想定外の支出を防ぐ / 支出の優先順位を見直す。上のバーを変えてその場で試せます。"
              : "最終的には資産が残るものの、途中でマイナスの期間があります。この試算はマイナス残高を無利息で借り続けられる前提を置いているため、実際には取り崩す順序やタイミングの見直しが必要です。「強い計画」と言い切るにはまだ早く、上のバーを変えて一時的な不足を解消できないか試してみてください。"}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.key} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {/*
                文言（「◯歳で尽きる」等）は scenarioOutcome に集約済み（最終レビュー指摘 F3）。
                色はこのカード固有の見せ方なので、文字列だけ受け取ってここで着ける
              */}
              <span
                className={
                  s.depletionAge !== null
                    ? "text-red-700"
                    : s.temporaryShortfall
                      ? "text-amber-700"
                      : "text-emerald-700"
                }
              >
                {scenarioOutcome(s)}
              </span>
            </div>
            {/*
              95歳時点の残高は補助情報。主役は上の「◯歳で尽きる」。
              意味のない桁の名目額を大きく出すと、かえって信頼性を削る
              （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6.4）
            */}
            <div className="mt-1 text-xs text-slate-500">
              95歳時点 {formatCompactYen(s.finalTotal)}
              <span className="ml-1">（今日のお金で）</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
