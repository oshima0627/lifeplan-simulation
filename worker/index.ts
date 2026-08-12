import type { Env } from "./env";
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // ASSETS（Fetcher）は Cloudflare 独自の Request/Response 型を要求するが、
      // 実体は標準 Fetch API と互換なので、境界でのみ型を合わせる。
      return env.ASSETS.fetch(
        request as unknown as Parameters<typeof env.ASSETS.fetch>[0],
      ) as unknown as Promise<Response>;
    }

    // 疎通確認用。ルーティングが効いているかを本番で見るためだけに置く。
    // GET 以外を弾いておくのは、以後のエンドポイントで同じ作法を使うため
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
      }
      return json({ ok: true });
    }

    return errorResponse("NOT_FOUND", "エンドポイントが存在しません", 404);
  },
};

export default worker;
