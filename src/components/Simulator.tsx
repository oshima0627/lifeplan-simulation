"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runAllScenarios } from "@/lib/lifeplan/scenarios";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { DEFAULT_SHEET, loadSheet, saveSheet } from "@/lib/storage";
import { CashflowChart } from "./CashflowChart";
import { DepletionVerdict } from "./DepletionVerdict";
import { HearingForm } from "./HearingForm";

/**
 * 全体の組み立て。
 *
 * 入力を変えるたびに即座に再計算してグラフを更新する。
 * 「どの項目をいじると資産が尽きる年がどう動くか」をその場で試せることが
 * このツールの本命の体験（docs/requirements.md §6）
 */
export function Simulator() {
  const [sheet, setSheet] = useState<HearingSheet>(DEFAULT_SHEET);

  // localStorage は静的エクスポート時のプリレンダリングでは触れないので、
  // マウント後に読み込んで差し替える。
  // レンダー中に読むと、ビルド時のHTML（既定値）とクライアントの初回描画が
  // 食い違って hydration 不一致になるため、この順序以外に安全な形が無い。
  // react-hooks/set-state-in-effect は「外部ストアとの同期」にあたるこの用途を
  // 弾いてくるので、理由を添えてこの1行だけ無効化する
  useEffect(() => {
    const saved = loadSheet();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setSheet(saved);
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

  // 入力が変わったときだけ再計算する
  const result = useMemo(() => runAllScenarios(sheet), [sheet]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/*
        モバイルでは判定カードが「主役」（docs/requirements.md §6）。
        フォーム(15項目前後)より先に表示されないと、判定に辿り着く前に
        スクロールで力尽きる。order で見た目の順序だけ入れ替え、
        DOM順・lg以上のカラム配置（フォーム左・結果右）は変えない
      */}
      <div className="order-2 flex flex-col gap-4 lg:order-1 lg:sticky lg:top-6 lg:self-start">
        <HearingForm sheet={sheet} onChange={setSheet} />
        <button
          type="button"
          className="self-start text-xs text-slate-500 underline hover:text-slate-800"
          onClick={() => {
            // clearSheet() は呼ばない。sheet を変えれば下の保存エフェクトが
            // 追随して DEFAULT_SHEET を localStorage に書き込むため、
            // ここで先に消しても直後の保存エフェクトに上書きされて意味がなかった
            // （呼んでも呼ばなくても結果は同じ、というデッドコードだった）
            setSheet(DEFAULT_SHEET);
          }}
        >
          入力内容を消して初期値に戻す
        </button>
      </div>
      <div className="order-1 flex flex-col gap-6 lg:order-2">
        <DepletionVerdict result={result} sheet={sheet} />
        <CashflowChart result={result} />
        <p className="text-xs text-slate-500">
          楽観＝利回り5%・昇給2%・インフレ1% ／ 普通＝3.5%・1%・2% ／
          悲観＝2%・0%・3%。95歳までを試算しています。
          この結果は特定の金融商品を推奨するものではありません。
        </p>
      </div>
    </div>
  );
}
