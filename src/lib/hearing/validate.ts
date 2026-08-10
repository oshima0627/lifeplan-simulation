import { HEARING_FIELDS, type FieldKey } from "./fields";

/** 検証の結果。受け入れる場合は正規化後の値を返す */
export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/**
 * 1項目ぶんの値を検証する。
 *
 * **なぜコード側で検証するのか（docs/requirements.md §3.2）:**
 * `output_config.format` の JSON Schema は `minimum` / `maximum` を
 * サポートしないため、範囲はスキーマで縛れない。
 * また §3.3 の通り Sonnet は不足パラメータを推測で埋めることがあり、
 * その値は「エラー」ではなく「もっともらしい嘘」として届く。
 * ここが最後の関門になる。
 *
 * 未知のキーは**例外にせず拒否として返す。** LLMがスキーマに無いキーを
 * 返してきたときに、呼び出し側を落とさないため
 */
export function validateField(key: FieldKey, value: unknown): ValidationResult {
  const spec = HEARING_FIELDS.find((f) => f.key === key);
  if (!spec) {
    return { ok: false, reason: `未知の項目です: ${String(key)}` };
  }

  if (spec.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, reason: `${spec.label}は数値で入力してください` };
    }
    // 丸めてから範囲を見る。丸めた結果が範囲外になる場合も拒否する
    const normalized = spec.integer ? Math.round(value) : value;
    if (normalized < spec.min || normalized > spec.max) {
      return {
        ok: false,
        reason: `${spec.label}は${spec.min}〜${spec.max}の範囲で入力してください`,
      };
    }
    return { ok: true, value: normalized };
  }

  if (spec.kind === "enum") {
    if (typeof value !== "string" || !spec.values.includes(value)) {
      return {
        ok: false,
        reason: `${spec.label}は${spec.values.join(" / ")}のいずれかを指定してください`,
      };
    }
    return { ok: true, value };
  }

  // kind === "list"
  if (!Array.isArray(value)) {
    return { ok: false, reason: `${spec.label}は一覧で指定してください` };
  }
  return { ok: true, value };
}
