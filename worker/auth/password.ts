// サーバー側のパスワード保存。重い鍵導出（PBKDF2）はブラウザで済んでいるので、
// ここでやるのは「受け取った鍵をソルトつきで1回ハッシュする」だけ。
// SHA-256 1回で足りる理由: 受け取る鍵は 256bit の高エントロピー値で、
// 辞書攻撃もレインボーテーブルも成立しない。攻撃者が DB を盗んでも、
// パスワードを1つ試すたびにブラウザ側の60万回を自分で回す必要がある。
//
// CPU コストはマイクロ秒オーダーなので、Workers 無料プランの 10ms に収まる。
//
// 鍵の形式判定（base64url 変換・43文字の長さ・既知の版番号）は
// shared/auth/kdf-format.ts に集約し、src/lib/auth/kdf.ts と共有している。
// `worker/` から `src/` は import しない（worker/tsconfig.json の
// "paths": {} で封じてある）が、`shared/` はどちらからも import できる。

import { fromBase64Url, isKnownKdfVersion, isValidClientKey, toBase64Url } from "../../shared/auth/kdf-format";

const SALT_BYTES = 16;
const SCHEME = "pbkdf2c"; // client-side PBKDF2 + server-side digest

// 保存形式: pbkdf2c-v<kdfVersion>$<serverSalt_b64url>$<digest_b64url>
// kdfVersion を含めるのは、後でブラウザ側の反復回数を上げたときに
// 「この人はまだ旧版」を判別して移行させるため。
function encode(version: number, salt: Uint8Array, digest: Uint8Array): string {
  return `${SCHEME}-v${version}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

function decode(
  stored: string,
): { version: number; salt: Uint8Array; digest: Uint8Array } | null {
  const [scheme, saltRaw, digestRaw] = stored.split("$");
  if (!scheme || !saltRaw || !digestRaw) return null;
  const m = /^pbkdf2c-v(\d+)$/.exec(scheme);
  if (!m) return null;
  try {
    return {
      version: Number(m[1]),
      salt: fromBase64Url(saltRaw),
      digest: fromBase64Url(digestRaw),
    };
  } catch {
    return null;
  }
}

async function digestKey(salt: Uint8Array, clientKey: string): Promise<Uint8Array> {
  const key = fromBase64Url(clientKey);
  const buf = new Uint8Array(salt.length + key.length);
  buf.set(salt, 0);
  buf.set(key, salt.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource));
}

/**
 * 定数時間のバイト列比較。
 *
 * Cloudflare Workers には crypto.subtle.timingSafeEqual の組み込みがあり、
 * **本番ではこちらが使われる**。Cloudflare が組み込みを推奨するのは
 * 「手書きの比較は早期 return などで間違えやすい」ためで、
 * 正しく書けた比較が危険なわけではない。
 *
 * ただしこれは Cloudflare 固有の拡張で、Vitest の Node 環境には存在しない
 * （`crypto.subtle.timingSafeEqual is not a function`）。テストを動かすために
 * 本番の実装を弱めるのは本末転倒なので、組み込みがあればそれを使い、
 * 無い環境でだけ定数時間のループにフォールバックする。
 *
 * ⚠️ 組み込みは長さが違うと例外を投げる。長さ自体は秘密ではない
 * （ダイジェストは常に32バイト）ので、どちらの経路でも先に長さで弾く。
 */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  const subtle: SubtleCrypto & {
    timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean;
  } = crypto.subtle;
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(a, b);
  }

  // フォールバック。**早期 return を書かないこと。**
  // 全バイトを必ず走査し、差分をビットORで蓄積してから1回だけ判定する。
  // 途中で return すると「何バイト目まで一致したか」が実行時間に漏れる。
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hashClientKey(
  clientKey: string,
  kdfVersion: number,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return encode(kdfVersion, salt, await digestKey(salt, clientKey));
}

export async function verifyClientKey(
  clientKey: string,
  stored: string,
): Promise<boolean> {
  const parsed = decode(stored);
  if (!parsed) return false; // 壊れた/移行用ダミーのハッシュは常に不一致
  try {
    return safeEqual(await digestKey(parsed.salt, clientKey), parsed.digest);
  } catch {
    return false;
  }
}

// 受け取った鍵の版が、保存済みの版と一致するか。
// 将来ブラウザ側の反復回数を上げたときは、ここで旧版を検知して
// 「再ログイン時に新版へ入れ替える」導線に使う。
export function storedKdfVersion(stored: string): number | null {
  return decode(stored)?.version ?? null;
}

// リクエストボディの検証。パスワード本体は届かないので、形だけを見る。
export function readClientKeyInput(
  body: { kdfVersion?: unknown; key?: unknown },
): { key: string; kdfVersion: number } | null {
  if (!isValidClientKey(body.key)) return null;
  if (!isKnownKdfVersion(body.kdfVersion)) return null;
  return { key: body.key, kdfVersion: body.kdfVersion };
}
