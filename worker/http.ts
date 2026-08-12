/**
 * API 応答の共通形。**すべてのエンドポイントがここを通る。**
 *
 * 個々のハンドラが Response を直接組み立てると、`cache-control` の付け忘れが
 * 必ず起きる。認証状態を含む応答が中間キャッシュに残ると別人に配られるため、
 * 付け忘れが起きない場所に集約する。
 */

/** エラー応答の本文。クライアントは code で分岐し、message をそのまま表示してよい */
export interface ErrorBody {
  error: { code: string; message: string };
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  // 認証状態を含む応答をキャッシュさせない
  "cache-control": "no-store",
};

/**
 * @param headers 追加ヘッダ（例: login/logout の `Set-Cookie`、レート制限の `Retry-After`）。
 *   **`BASE_HEADERS` が必ず勝つ。** 呼び出し側が誤って `cache-control` 等を渡しても
 *   上書きされない（`{ ...headers, ...BASE_HEADERS }` の順序で担保している）。
 */
export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...BASE_HEADERS },
  });
}

/**
 * エラー応答。
 *
 * ⚠️ message はユーザーにそのまま見せる文言だけを入れること。
 * 例外の生メッセージを入れると、設定の不備やDBの構造が外に漏れる。
 * 原因は console.error で運用ログにだけ残す。
 *
 * @param headers 追加ヘッダ。`json()` と同じく `BASE_HEADERS` が必ず勝つ。
 */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  const body: ErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...BASE_HEADERS },
  });
}
