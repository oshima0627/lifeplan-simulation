// 課金APIを叩くブラウザ側クライアント。
//
// ⚠️ `credentials: "same-origin"` を必ず付ける。付けないとセッション Cookie が
// 送られず、全て 401 になる（src/lib/auth/client.ts と同じ理由）。
//
// ⚠️ 金額・上限回数をここに書かない。サーバー（worker/billing/entitlement.ts）が
// 返した値だけを表示する。2箇所に書くと必ず食い違う。
//
// ⚠️ `fetchImpl` で fetch を差し替えられるようにしてある（テストが通信しないため）。

/** `GET /api/billing/status` の応答。worker/billing/entitlement.ts の Entitlement と対。 */
export interface BillingStatus {
  paid: boolean;
  limit: number;
  used: number;
  remaining: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const NETWORK_ERROR: { ok: false; code: string; message: string } = {
  ok: false,
  code: "NETWORK_ERROR",
  message: "通信に失敗しました。ネットワークの状態を確認してからもう一度お試しください",
};

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function call<T>(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<BillingResult<T>> {
  let status: number;
  let body: unknown;
  try {
    const res = await fetchImpl(input, { ...init, credentials: "same-origin" });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    // 画面を落とすより、エラー表示のほうが良い（認証側と同じ方針）
    return NETWORK_ERROR;
  }

  if (status >= 200 && status < 300) return { ok: true, value: body as T };

  // サーバーの文言をそのまま使う。ここで言い換えると
  // 「すでにご契約中です」のような分岐ごとの案内が崩れる
  const error = (body as ErrorBody | null)?.error;
  return {
    ok: false,
    code: typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR",
    message: typeof error?.message === "string" ? error.message : "エラーが発生しました",
  };
}

/** 契約状態と今月の残り回数。 */
export function fetchBillingStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<BillingResult<BillingStatus>> {
  return call<BillingStatus>(fetchImpl, "/api/billing/status", { method: "GET" });
}

/** Checkout（新規契約）のURL。 */
export function startCheckout(
  fetchImpl: typeof fetch = fetch,
): Promise<BillingResult<{ url: string }>> {
  return call<{ url: string }>(fetchImpl, "/api/billing/checkout", { method: "POST" });
}

/** カスタマーポータル（解約・カード変更）のURL。 */
export function openPortal(
  fetchImpl: typeof fetch = fetch,
): Promise<BillingResult<{ url: string }>> {
  return call<{ url: string }>(fetchImpl, "/api/billing/portal", { method: "POST" });
}
