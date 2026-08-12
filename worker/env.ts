import type { D1Database, Fetcher } from "@cloudflare/workers-types";

/**
 * Worker が受け取るバインディングとシークレットの形。
 *
 * ⚠️ シークレットは `wrangler.jsonc` の `vars` に置かない（平文でダッシュボードから
 * 見える）。`wrangler secret put` で投入する。この型に足すのは名前だけで、
 * 値をコードに書かないこと（docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §7 相当）。
 *
 * A-1 の時点ではシークレットを使わないので、バインディングだけを持つ。
 */
export interface Env {
  /** 静的アセット。/api/* 以外のリクエストはここに委ねる */
  ASSETS: Fetcher;
  /** 認証・課金・利用回数を保存する D1（家計情報は入れない） */
  DB: D1Database;
}
