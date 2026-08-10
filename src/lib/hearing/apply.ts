import type { HearingSheet } from "@/lib/lifeplan/types";
import type { FieldKey } from "./fields";
import { validateField } from "./validate";

/** 受け入れられなかった項目と、その理由 */
export type RejectedField = { key: string; reason: string };

/**
 * LLMの抽出結果をシートにマージする（docs/requirements.md §3.2）。
 *
 * **不正な値は黙って捨てず、理由を返す。** §3.3 の通り Sonnet は
 * 不足パラメータを推測で埋めることがあり、その値はエラーではなく
 * 「もっともらしい嘘」として届く。捨てたことを呼び出し側が知り、
 * 会話で聞き直せるようにする
 *
 * `null` / `undefined` は「まだ分からない」の意味として扱い、
 * 拒否には数えない。LLMが不明を null で返してくるため
 */
export function applyExtraction(
  sheet: Partial<HearingSheet>,
  extracted: unknown,
): { sheet: Partial<HearingSheet>; rejected: RejectedField[] } {
  if (typeof extracted !== "object" || extracted === null) {
    return { sheet: { ...sheet }, rejected: [] };
  }

  const next: Partial<HearingSheet> = { ...sheet };
  const rejected: RejectedField[] = [];

  for (const [key, value] of Object.entries(extracted)) {
    // 「まだ分からない」は未入力のままにする。拒否ではない
    if (value === null || value === undefined) continue;

    const result = validateField(key as FieldKey, value);
    if (result.ok) {
      // 検証を通った値だけを入れる。値は正規化済み（小数は丸められている）
      (next as Record<string, unknown>)[key] = result.value;
    } else {
      rejected.push({ key, reason: result.reason });
    }
  }

  return { sheet: next, rejected };
}
