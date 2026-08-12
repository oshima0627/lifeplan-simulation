// パスワードから鍵を導出する処理。**ブラウザ側で実行する**（サーバーからも
// 同じ正規化ルールを使うので、サーバー専用の import を持ち込まないこと）。
//
// なぜクライアントでやるか:
//   PBKDF2 は「わざと重くする」ことが目的の処理で、Workers 無料プランの
//   CPU 10ms/リクエストには原理的に収まらない。サーバーで回数を削ると
//   ストレッチングの意味が消えるため、計算そのものを利用者の端末に移した。
//   サーバーは受け取った鍵を1回ハッシュするだけ（1ms未満）で済む。
//
// これで防御力が落ちないのは、DB が漏れても攻撃者はパスワードを1つ推測する
// たびに下記の反復回数を自分で回す必要があるため。CPU を気にしなくてよい分、
// サーバー実行時より強い設定にできている。
//
// 代償: JavaScript が必須になり、サーバー側でパスワード長を検証できない
//       （長さのチェックはブラウザ側の助言に留まる。docs/03）。

import { normalizeEmail } from "../../../shared/auth/email";
import {
  fromBase64Url,
  isKnownKdfVersion,
  isValidClientKey,
  KDF_VERSION,
  toBase64Url,
} from "../../../shared/auth/kdf-format";

// 鍵の形式判定（版番号・base64url の長さ）は shared/auth/kdf-format.ts に
// 集約している。worker/auth/password.ts と同じ実体を import することで、
// 「片方だけ更新して版がズレる」事故を型レベルで防ぐ。
export { KDF_VERSION, isKnownKdfVersion, isValidClientKey, toBase64Url, fromBase64Url };

const KDF_PARAMS: Record<number, { iterations: number }> = {
  // 端末側で約0.2〜0.6秒。ログインは頻繁ではないので許容できる
  1: { iterations: 600_000 },
};

const KEY_BITS = 256;

// パスワードの長さ。サーバーでは検証できないので、ここは利用者への助言。
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

// ソルトはメールから決定的に作る。サーバーに問い合わせずに導出できるので、
// 「このアドレスは登録済みか」を答える窓口を作らずに済む（存在の洗い出し対策）。
async function saltFor(email: string, version: number): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`lifeplan-kdf-v${version}:${email}`),
  );
  return new Uint8Array(digest);
}

// ブラウザで実行する本体。返り値がサーバーへ送る「パスワードの代わり」になる。
export async function deriveClientKey(
  email: string,
  password: string,
): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("メールアドレスの形式が正しくありません");
  const params = KDF_PARAMS[KDF_VERSION];
  if (!params) throw new Error("鍵導出のパラメータが未定義です");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: (await saltFor(normalized, KDF_VERSION)) as BufferSource,
      iterations: params.iterations,
    },
    key,
    KEY_BITS,
  );
  return toBase64Url(new Uint8Array(bits));
}
