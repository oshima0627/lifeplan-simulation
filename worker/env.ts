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
/**
 * `APP_URL`（パスワード再設定メールのリンク組み立てに使う正規オリジン。
 * 例: `https://lifeplan.nexeed-lab.com`）は `wrangler.jsonc` の `vars` に
 * 定義済みで、`npm run cf:typegen` が生成する `Env`（`worker/worker-configuration.d.ts`）
 * に既に含まれるため、ここで再宣言しない（`MAIL_FROM` と同じ扱い。`string` として
 * 再宣言すると、生成側のリテラル型 `"https://lifeplan.nexeed-lab.com"` より
 * 広い型になり `interface ... incorrectly extends` で型検査が落ちる）。
 *
 * ⚠️ `worker/auth/reset.ts` はこの `env.APP_URL` だけを使い、
 * `Request.url` からは絶対に導出しないこと。Workers には `http://` の
 * リクエストもそのまま届く（`worker/auth/routes.ts` の
 * `shouldSecureCookie` のコメント参照）ため、そこからスキームやポートを
 * 信用すると、攻撃者が `http://` や非標準ポートで送ったリクエストの情報が
 * そのまま再設定メールのリンクに混入する（踏んだ瞬間トークンが平文で流れる／
 * 企業網でブロックされ得るポートが混入する）。
 */
export interface AppEnv extends Env {
  RESEND_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  /**
   * Stripe の秘密鍵と Webhook 署名シークレット。どちらも `wrangler secret put` で
   * 投入する。`wrangler.jsonc` の `vars` に書くと Cloudflare ダッシュボードから
   * 平文で見えてしまう。
   *
   * 一方 `STRIPE_PRICE_ID` は公開されても害が無い（価格の識別子であって
   * 権限は持たない）ので `vars` に置く。`vars` は `wrangler types` の生成物に
   * 出るため、ここでは再宣言しない（再宣言するとリテラル型より広くなって
   * 型検査が落ちる。`APP_URL` と同じ理由）。
   */
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}
