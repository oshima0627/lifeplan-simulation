import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import type { HearingSheet, LifeEvent } from "./types";

/**
 * 「黙って間違う」条件を1か所にまとめた純粋関数群。
 *
 * BasicInfoFields・InputWarnings・OptionalDetailsForm・HearingModal の4つが同じ条件を使う必要がある
 * （最終レビュー指摘 C1）。条件式をコンポーネントごとにコピーすると、
 * 一方だけ直して他方に反映し忘れる事故が再発するため、ここに集約する
 */

/**
 * リタイア予定年齢が現在の年齢を下回っているか。
 *
 * この状態では cashflow.ts の `age < sheet.retirementAge` が
 * 全期間 false になり、給与収入が黙って0円として試算され続ける
 */
export function isRetirementAgeInvalid(sheet: HearingSheet): boolean {
  return sheet.retirementAge < sheet.currentAge;
}

/**
 * 年金受給開始年齢（省略時は DEFAULT_PENSION_START_AGE）が
 * 現在の年齢を下回っているか
 */
export function isPensionStartAgeInvalid(sheet: HearingSheet): boolean {
  const effectivePensionStartAge = sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE;
  return effectivePensionStartAge < sheet.currentAge;
}

/**
 * イベントの発生年齢が試算範囲（現在の年齢〜LIFE_EXPECTANCY_AGE）の外にあるか。
 * 範囲外のイベントは計算エンジンが黙って無視する
 */
export function isEventAgeOutOfRange(event: LifeEvent, currentAge: number): boolean {
  return event.age < currentAge || event.age > LIFE_EXPECTANCY_AGE;
}
