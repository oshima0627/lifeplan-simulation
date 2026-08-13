"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { REAL_SCENARIOS } from "@/constants/lifeplan";
import { runAllScenarios } from "@/lib/lifeplan/scenarios";
import { toRealTerms } from "@/lib/lifeplan/realTerms";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { DEFAULT_SHEET, loadSheet, saveSheet } from "@/lib/storage";
import { BasicInfoBar } from "./BasicInfoBar";
import { CashflowChart } from "./CashflowChart";
import { DepletionVerdict } from "./DepletionVerdict";
import { DerivedSummary } from "./DerivedSummary";
import { HearingModal } from "./HearingModal";
import { OptionalDetailsForm } from "./OptionalDetailsForm";
import SavedPlans from "./plans/SavedPlans";
import { VerdictSummary } from "./VerdictSummary";

/**
 * 全体の組み立て。
 *
 * 入力を変えるたびに即座に再計算してグラフを更新する。
 * 「どの項目をいじると資産が尽きる年がどう動くか」をその場で試せることが
 * このツールの本命の体験（docs/requirements.md §6）
 */
export function Simulator() {
  const [sheet, setSheet] = useState<HearingSheet>(DEFAULT_SHEET);
  const [modalOpen, setModalOpen] = useState(false);

  // localStorage は静的エクスポート時のプリレンダリングでは触れないので、
  // マウント後に読み込んで差し替える。
  // レンダー中に読むと、ビルド時のHTML（既定値）とクライアントの初回描画が
  // 食い違って hydration 不一致になるため、この順序以外に安全な形が無い。
  // react-hooks/set-state-in-effect は「外部ストアとの同期」にあたるこの用途を
  // 弾いてくるので、理由を添えてこの1行だけ無効化する
  useEffect(() => {
    const saved = loadSheet();
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSheet(saved);
    } else {
      // 保存が無い＝初回訪問。何を入れればいいか分からない人を
      // ステップ式の入力に案内する。復元と同じエフェクトで判定するのは、
      // 別エフェクトにすると復元前に「保存が無い」と誤判定して
      // 毎回開いてしまうため
      setModalOpen(true);
    }
  }, []);

  // 復元エフェクトと同じフラッシュで走る初回の保存を飛ばすためのフラグ。
  // これが無いと、復元が反映される前に「既定値」で localStorage を上書きしてしまう。
  // 直後に復元値で書き直されるので実害は出ないが、その正しさは
  // React のエフェクト実行順序に依存していて壊れやすいため、明示的に守る
  const skipFirstSave = useRef(true);

  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    saveSheet(sheet);
  }, [sheet]);

  // 入力が変わったときだけ再計算する。
  // エンジンは名目で計算し、ここで「今日の購買力」に直してから表示に渡す
  // （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6.2）。
  // シナリオごとにインフレ率が違うため、名目のままでは3つの数字が
  // それぞれ違う購買力の「円」になり、並べて比較できない
  const result = useMemo(() => {
    const nominal = runAllScenarios(sheet);
    return {
      ...nominal,
      scenarios: nominal.scenarios.map((s) => {
        const assumption = REAL_SCENARIOS.find((r) => r.key === s.key);
        // 見つからないことは無いが、見つからなければ変換せずそのまま返す
        // （名目のまま表示される方が、0で割って壊れるより安全）
        return assumption ? toRealTerms(s, assumption.inflationPct) : s;
      }),
    };
  }, [sheet]);

  return (
    <>
      <HearingModal
        sheet={sheet}
        onChange={setSheet}
        open={modalOpen}
        onClose={() => {
          // モーダルを閉じた時点で明示的に保存する。既定値のまま1項目も
          // 変えずに完走した場合、sheet が一度も変化せず保存エフェクトが
          // 発火しないため、これが無いと再読み込みでモーダルが再び開いてしまう
          // （最終レビュー指摘 M-3）
          saveSheet(sheet);
          setModalOpen(false);
        }}
      />
      {/*
        画面に固定される領域。バー・警告・判定1行・グラフをここに入れる。
        ⚠️ 背景を不透明にすること。透明だと下からスクロールしてきた文字が
        透けて重なる。z-40 はポップアップ（z-50）より下、他より上
        ⚠️ この要素より上（layout.tsx / page.tsx）に overflow を足さないこと。
        祖先に overflow があると sticky はエラーも出さずに効かなくなる
      */}
      <div className="sticky top-0 z-40 -mx-4 border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <BasicInfoBar sheet={sheet} onChange={setSheet} />
        <div className="mt-2 flex flex-col gap-2">
          <VerdictSummary result={result} />
          <CashflowChart result={result} />
        </div>
      </div>

      {/* ここから下がスクロールする */}
      <div className="flex flex-col gap-6 pt-6">
        <DepletionVerdict result={result} sheet={sheet} />
        <DerivedSummary sheet={sheet} />
        <OptionalDetailsForm sheet={sheet} onChange={setSheet} />
        <div className="flex flex-col gap-4">
          <button
            type="button"
            className="self-start text-xs text-slate-600 underline hover:text-slate-900"
            onClick={() => setModalOpen(true)}
          >
            入力をやり直す
          </button>
          <button
            type="button"
            className="self-start text-xs text-slate-500 underline hover:text-slate-800"
            onClick={() => {
              // clearSheet() は呼ばない。sheet を変えれば保存エフェクトが
              // 追随して DEFAULT_SHEET を localStorage に書き込むため、
              // ここで先に消しても直後の保存エフェクトに上書きされて意味がなかった
              setSheet(DEFAULT_SHEET);
            }}
          >
            入力内容を消して初期値に戻す
          </button>
          {/* ログインしている人にだけ出る。未ログインなら何も描画しない */}
          <SavedPlans sheet={sheet} onLoad={setSheet} />
        </div>
        <p className="text-xs text-slate-500">
          <strong>金額はすべて今日の購買力に換算しています。</strong>
          将来の物価上昇分を差し引いた「実質」の値です。
          楽観＝実質利回り5%・実質昇給+1% ／ 普通＝3%・0% ／ 悲観＝1%・-1%。
          退職金は名目で受け取る前提のため、インフレ（楽観1%・普通2%・悲観3%）で目減りさせて表示しています。
          95歳までを試算しています。
          この結果は特定の金融商品を推奨するものではありません。
        </p>
      </div>
    </>
  );
}
