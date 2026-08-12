/**
 * メールアドレスの正規化。
 *
 * ⚠️ **ブラウザとサーバーで必ず同じ結果になること。**
 * ブラウザ側の鍵導出はこの正規化結果からソルトを作る（src/lib/auth/kdf.ts）。
 * ズレるとソルトが変わり、**正しいパスワードでもログインできなくなる。**
 * だからこの関数だけを shared/ に置き、両方から同じ実体を import する。
 *
 * サーバー側でも必ず再正規化すること。クライアントの正規化を信用して
 * そのまま保存すると、`A@x.com` と `a@x.com` で2アカウント作れてしまい、
 * users.email の UNIQUE 制約も「お試しは月1回」の数え方も無意味になる。
 *
 * 厳密な RFC 準拠は狙わない。最終的な到達性はメールが届くかどうかで決まる。
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
