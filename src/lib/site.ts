/**
 * 公開時のサイト URL。sitemap.xml / robots.txt / canonical で使う。
 *
 * worker 側の `APP_URL`（`wrangler.jsonc` の vars）と同じ値だが、こちらは
 * `output: "export"` のビルド時に評価されるため、worker の環境変数からは読めない。
 * 変えるときは両方そろえること。
 */
export const SITE_URL = "https://lifeplan.nexeed-lab.com";

/**
 * 検索結果に載せるページ。
 *
 * ログイン・登録・アカウント・パスワード再設定は、検索から来ても意味が無く、
 * 中身も互いにほぼ同じなので載せない（robots.txt 側でもクロールを止める）。
 */
export const INDEXABLE_PATHS = ["/", "/privacy"] as const;

/** 検索結果に載せないページ。robots.txt の Disallow に使う */
export const NON_INDEXABLE_PATHS = [
  "/login",
  "/signup",
  "/account",
  "/forgot-password",
  "/reset-password",
] as const;
