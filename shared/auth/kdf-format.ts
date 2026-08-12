/**
 * クライアント鍵の「形式」に関する、ブラウザ・Worker 共通の定義。
 *
 * ここにあるのは判定ロジックだけ。PBKDF2 の導出そのもの（deriveClientKey）は
 * ブラウザ専用の重い処理なので、ここには含めない（src/lib/auth/kdf.ts に残す）。
 *
 * KDF_VERSION を上げるときは、ここを更新してから両方の実装
 * （src/lib/auth/kdf.ts の KDF_PARAMS、worker 側の検証）を追随させること。
 * 片方だけ更新すると、正しいパスワードが全ユーザーで弾かれる。
 *
 * ⚠️ この shared/ は worker 側では `lib` から `dom` を外した環境
 * （worker/tsconfig.json）でも型検査される。DOM API・DOM 型を使わないこと。
 */

/** クライアント鍵（256bit を base64url にした長さ）。 */
export const KEY_BASE64URL_LENGTH = 43;

/** サーバー・ブラウザ双方が知っている KDF バージョン。現行は 1 のみ。 */
export const KDF_VERSION = 1;

const KNOWN_KDF_VERSIONS = new Set([KDF_VERSION]);

/** 受け取った版番号が既知（サポート対象）かどうか。 */
export function isKnownKdfVersion(raw: unknown): raw is number {
  return typeof raw === "number" && KNOWN_KDF_VERSIONS.has(raw);
}

/** クライアント鍵の形（43文字の base64url）だけを検査する。中身は検証しようがない。 */
export function isValidClientKey(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    raw.length === KEY_BASE64URL_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(raw)
  );
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
