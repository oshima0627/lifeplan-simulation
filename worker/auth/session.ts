// セッショントークンの発行とハッシュ化。
//
// ⚠️ `worker/` から `src/` を import しない（worker/tsconfig.json の
// "paths": {} で封じてある）。そのため `src/lib/auth/kdf.ts` にある
// base64url 変換と同等の実装をここに複製している（password.ts と同じ理由）。

export const SESSION_TTL_DAYS = 30;

// 32バイトの乱数をセッショントークンにする。Cookie にはこの生値だけを入れる。
// `Math.random()` は予測可能なので使わない。
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// D1 に保存するのはハッシュだけ。DB が漏れてもセッションを復元できないようにする。
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// セッションの有効期限（ISO文字列）。`from` を省略すると現在時刻基準。
export function sessionExpiryIso(from: Date = new Date()): string {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
