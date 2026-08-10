/**
 * フォームの行（子供・任意イベント）に振る安定ID。
 *
 * 仕様（docs/requirements.md §4.1）:
 * - 行の作成時に一度だけ採番し、以後変更しない
 * - **内容から導出しない。** 同じ年齢・同じ金額の行が並びうるため、
 *   内容を元にすると衝突して React の key が破綻する
 *
 * `crypto.randomUUID` は安全なコンテキスト（https / localhost）でしか
 * 生えないため、無い環境ではカウンタ併用のフォールバックを使う。
 * ここで採番するIDは表示にもURLにも使わない内部識別子なので、
 * 暗号学的な強度は要らない。要るのは「衝突しないこと」だけ
 */
let counter = 0;

export function newRowId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  counter += 1;
  return `row-${Date.now().toString(36)}-${counter.toString(36)}`;
}
