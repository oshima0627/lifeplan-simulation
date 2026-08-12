// Cloudflare Turnstile のサーバー側検証。
//
// エンドポイント（`https://challenges.cloudflare.com/turnstile/v0/siteverify`）は
// `application/x-www-form-urlencoded` と `application/json` の両方を受け付け、
// 常にJSONで応答する（公式ドキュメント
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// の記載、および同ページのJavaScriptサンプルで確認。2026-08-12 時点）。
// ここではWorkers上で組み立てやすいJSONを送る。
//
// ⚠️ 検証に失敗したら必ず false を返すこと。ネットワークエラー・タイムアウト・
// HTTPステータス異常・不正なJSON・想定外の応答形式のいずれでも true にしない。
// ここが true に倒れると、攻撃者は Cloudflare のエンドポイントへの到達を
// 妨害するだけで検証を素通りできてしまい、Turnstile を置いた意味が消える。

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
}

function isSiteverifyResponse(value: unknown): value is SiteverifyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}

/**
 * Turnstile のクライアント側トークンをCloudflareのsiteverifyエンドポイントで検証する。
 *
 * @param token クライアントから送られてきたトークン。文字列でなければ
 *   fetch を呼ばずに false を返す（無駄な外部通信をしない）。
 * @param secret Turnstile のシークレットキー。
 * @param remoteIp 送信者のIP（任意）。渡した場合のみ `remoteip` を本文に含める。
 * @param fetchImpl テストから差し替えるための fetch 実装。省略時はグローバル fetch。
 */
export async function verifyTurnstile(
  token: unknown,
  secret: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== "string") return false;

  const body: Record<string, string> = { secret, response: token };
  if (remoteIp !== undefined) body.remoteip = remoteIp;

  let res: Response;
  try {
    res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // ネットワークエラー・タイムアウトなど。到達できない=不正、ではなく
    // 「検証できなかった」なので false（安全側）に倒す。
    return false;
  }

  if (!res.ok) return false;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return false;
  }

  if (!isSiteverifyResponse(data)) return false;
  return data.success;
}
