import { handleAuthRoute } from "./auth/routes";
import type { AppEnv } from "./env";
import { errorResponse, json } from "./http";

/**
 * Worker のエントリ。
 *
 * `/api/*` だけを自分で処理し、それ以外は静的アセットに委ねる。
 *
 * ⚠️ `wrangler.jsonc` の `run_worker_first: ["/api/*"]` と対になっている。
 * あちらが無いと、ナビゲーションリクエスト（アドレスバーへの直接入力・素のフォーム
 * POST・外部からのリダイレクト着地）が Worker に届かず 404.html が返る。
 * `fetch()` からの呼び出しだけは届いてしまうため、**設定を消しても
 * 普通に使っている限り気づけない。**
 */
const worker = {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // ここから先で投げられた例外は必ずこの catch を通る。
    // 「全応答が http.ts (json / errorResponse) を通る」という不変条件の
    // 唯一の抜け道が「例外が投げっぱなしになり Cloudflare の既定のエラーページ
    // （cache-control 無し・本文が JSON でない）が返る」ケースだったため塞ぐ。
    try {
      // 疎通確認用。ルーティングが効いているかを本番で見るためだけに置く。
      // GET 以外を弾いておくのは、以後のエンドポイントで同じ作法を使うため
      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
        }
        return json({ ok: true });
      }

      const authResponse = await handleAuthRoute(request, env, url);
      if (authResponse) return authResponse;

      return errorResponse("NOT_FOUND", "エンドポイントが存在しません", 404);
    } catch (err) {
      // 例外の生メッセージは応答に含めない（設定の不備やDBの構造が外に漏れる）。
      // 原因は運用ログにだけ残す。
      console.error(err);
      return errorResponse("INTERNAL_ERROR", "サーバーエラーが発生しました", 500);
    }
  },
} satisfies ExportedHandler<AppEnv>;

export default worker;
