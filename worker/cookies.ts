/** セッションCookieの名前。pre-meet の pm_session と衝突させない */
export const SESSION_COOKIE = "lp_session";

/**
 * Set-Cookie の値を組み立てる。
 *
 * - `HttpOnly` … JavaScript から読めなくする（XSS でトークンを盗まれない）
 * - `SameSite=Lax` … 他サイトからのPOSTにCookieを載せない（CSRF対策）
 * - `Path=/` … サイト全体で使う
 * - `Secure` … https のときだけ付ける。ローカル開発（http）では付けない
 */
export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** リクエストの Cookie ヘッダから1つ取り出す */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
