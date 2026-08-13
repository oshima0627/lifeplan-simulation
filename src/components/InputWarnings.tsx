"use client";

import { isPensionStartAgeInvalid, isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet } from "@/lib/lifeplan/types";

/**
 * 「黙って間違う」入力を知らせる行。
 *
 * ⚠️ 左の入力カラムではなく、右の固定領域に置く。狭い画面（1024px未満）では
 * 左カラムごと入力欄が消えるため、警告を入力欄の隣に置くと
 * 「試算が黙って間違っている」ことに一度も気づけない（設計書 §4）。
 *
 * ⚠️ role="alert" は使わない。値を変えるたびに読み上げが割り込む。
 * 助言は role="status"。role="banner" はサイトヘッダのランドマークなので論外。
 *
 * ⚠️ role="status" の要素自体は警告の有無に関わらず常に描画し、中身だけを
 * 出し入れする。要素ごと出し入れすると、ライブリージョンが中身と同時にDOMへ
 * 挿入されることになり、スクリーンリーダーの実装によっては読み上げが発火しない。
 * 警告が無いときに枠線や余白が目に見えないよう、装飾のクラスは中身がある場合にだけ付ける
 */
export function InputWarnings({ sheet }: { sheet: HearingSheet }) {
  const retirementInvalid = isRetirementAgeInvalid(sheet);
  const pensionInvalid = isPensionStartAgeInvalid(sheet);

  return (
    <div
      role="status"
      className={
        retirementInvalid || pensionInvalid
          ? "rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
          : undefined
      }
    >
      {retirementInvalid && (
        <p>
          ⚠️ リタイア予定年齢が現在の年齢より前になっています。この状態では
          給与収入が全期間0円として試算されます
        </p>
      )}
      {pensionInvalid && (
        // フォーム側（OptionalDetailsForm）の同じ警告と完全に同一の文言にはしていない。
        // こちらは項目が離れた場所にあるため項目名を含める必要があるが、
        // フォーム側は項目のすぐ隣に出るので項目名を繰り返す必要がない
        <p>⚠️ 年金の受給開始年齢が現在の年齢より前になっています。現在の年齢以上に修正してください</p>
      )}
    </div>
  );
}
