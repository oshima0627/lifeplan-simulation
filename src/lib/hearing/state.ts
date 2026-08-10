import type { HearingSheet } from "@/lib/lifeplan/types";
import { HEARING_FIELDS, type FieldKey } from "./fields";

/** ヒアリングの進行段階 */
export type HearingPhase = "tier1" | "tier2" | "complete";

/**
 * その項目が入力済みかどうか。
 *
 * **`0` と空配列は「入力済み」。** 貯金0円・年金0円・子供なしは
 * どれも正当な回答であり、未入力と混同すると永久に聞き続けることになる。
 * 未入力は `undefined`（および `null`）だけ
 */
function isFilled(sheet: Partial<HearingSheet>, key: FieldKey): boolean {
  const v = sheet[key];
  return v !== undefined && v !== null;
}

/** 指定した Tier の未入力項目を、定義順で返す */
export function missingFields(
  sheet: Partial<HearingSheet>,
  tier: 1 | 2,
): FieldKey[] {
  return HEARING_FIELDS.filter((f) => f.tier === tier && !isFilled(sheet, f.key)).map(
    (f) => f.key,
  );
}

/**
 * いまどの段階にいるか（docs/requirements.md §4）。
 *
 * Tier 1 が埋まるまでは会話を終わらせない。埋まったら
 * 「一度計算できます。もう少し精度を上げますか？」と提案する段階に進む
 */
export function currentPhase(sheet: Partial<HearingSheet>): HearingPhase {
  if (missingFields(sheet, 1).length > 0) return "tier1";
  if (missingFields(sheet, 2).length > 0) return "tier2";
  return "complete";
}

/**
 * 次に聞くべき項目。すべて揃っていれば `null`。
 *
 * **Tier 1 を必ず先に埋める。** 計算できない状態のまま
 * 任意項目を聞き続けるのを防ぐ
 */
export function nextField(sheet: Partial<HearingSheet>): FieldKey | null {
  return missingFields(sheet, 1)[0] ?? missingFields(sheet, 2)[0] ?? null;
}

/**
 * 進捗。**LLMに言わせず、ここで算出する**（docs/requirements.md §3.1）。
 * 会話が長くなるとLLMの自己申告は当てにならなくなる
 */
export function progress(sheet: Partial<HearingSheet>): {
  filled: number;
  total: number;
} {
  const filled = HEARING_FIELDS.filter((f) => isFilled(sheet, f.key)).length;
  return { filled, total: HEARING_FIELDS.length };
}
