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
 *
 * ⚠️ フォールバック側の `counter` はページ再読み込みで 0 に戻るため、
 * セッションをまたいだ一意性は `Date.now()` がミリ秒単位で前回セッションと
 * 異なることに依存する。この id は localStorage に永続化されるが、
 * 同一ミリ秒×同一カウンタ値でしか衝突しない（`crypto.randomUUID` が
 * 使えない環境限定）ため実用上は安全と判断している
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
