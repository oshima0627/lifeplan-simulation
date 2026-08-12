/**
 * `wrangler types` の生成物（worker/worker-configuration.d.ts、グローバルな
 * `Env`）を拡張する。
 *
 * 生成物は `wrangler.jsonc` の `vars` / バインディングと `.dev.vars` から
 * 作られるため、`RESEND_API_KEY` のような **シークレット**（`wrangler secret
 * put` で投入し、値を `wrangler.jsonc` にも `.dev.vars` にも書かない）は
 * 生成物に現れない。
 *
 * 生成ファイル（worker/worker-configuration.d.ts）を直接編集すると
 * `npm run cf:typegen` の再生成で消えるため、ここで拡張する形にする。
 * **値をこのファイルに書かないこと**（Cloudflare ダッシュボードから見える
 * 場所に置かない）。
 */
export interface AppEnv extends Env {
  RESEND_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}
