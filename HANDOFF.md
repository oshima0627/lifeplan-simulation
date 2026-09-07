# HANDOFF

最終更新: 2026-09-07

## いま何をしているのか

**本番は稼働中**（`https://lifeplan.nexeed-lab.com/` が HTTP 200・2026-09-07 に curl で実測）。
2026-08-25 の雛形には「未デプロイ」と読める記述が残っていたが、実際には出ている。

このセッションでやったのは **検索エンジン向けの入口の整備だけ**。
アプリの機能には一切触っていない。

Search Console に `sc-domain:lifeplan.nexeed-lab.com` のプロパティがあるのに
`sitemap.xml` が 404 で、サイトマップを登録できない状態だった。そこを埋めた。

## 今回やったこと（コミット `838b6de`・push 済み）

| ファイル | 内容 |
|---|---|
| `src/lib/site.ts` | **新規。** `SITE_URL` と、検索結果に載せる／載せないパスの一覧 |
| `src/app/sitemap.ts` | **新規。** `/` と `/privacy` の2件を出す |
| `src/app/robots.ts` | **新規。** ログイン系5パスを Disallow、`Sitemap:` 行あり |

設計上の判断:

- **載せるのは `/` と `/privacy` だけ。** `/login` `/signup` `/account` `/forgot-password`
  `/reset-password` は検索から来ても意味が無く、互いにほぼ同じ中身なので Disallow に回した
- **`lastModified` は入れない。** `output: "export"` ではビルドのたびに値が変わり、
  中身が変わっていないページまで「更新された」と伝えてしまう
- **`SITE_URL` は worker の `APP_URL`（`wrangler.jsonc` の vars）と同じ値の二重管理。**
  `output: "export"` のビルド時には worker の環境変数を読めないため。**変えるときは両方そろえる**

## 検証済みの事実（実際に画面に出した出力）

- `npm run typecheck`（本体 + `worker/tsconfig.json`）→ **エラー 0**
- `npm test`（vitest）→ **52 ファイル / 584 テスト 全て pass / 0 fail**
- `npm run build` 成功。ルート一覧に `/robots.txt` と `/sitemap.xml` が
  `○ (Static)` として出ることを確認
- `out/sitemap.xml` の中身 = `https://lifeplan.nexeed-lab.com` と `.../privacy` の2件
- `out/robots.txt` の中身 = `Allow: /` + Disallow 5行 + `Sitemap:` 行
- 本番の実測（2026-09-07・変更前）: `/` は 200、`/privacy` は 200、
  `/sitemap.xml` は **404**、`/robots.txt` は Next の 404 ページ（HTML）

## 未検証のもの

- **本番に反映していない。** このリポジトリは push で自動デプロイされない。
  反映するには手元から下を実行する（要 `wrangler login`）:

  ```bash
  npm run deploy
  ```

- 反映後の確認:

  ```bash
  curl -s https://lifeplan.nexeed-lab.com/sitemap.xml
  curl -s https://lifeplan.nexeed-lab.com/robots.txt
  ```

- **GSC へのサイトマップ登録はまだ。** 上が 200 を返すようになってから、
  親プロパティ `sc-domain:nexeed-lab.com` のサイトマップ画面で
  `https://lifeplan.nexeed-lab.com/sitemap.xml` を送信する
- **`/` が検索で拾われるかは未検証。** インデックス状況は 2026-09-04 時点で
  GSC が「データを処理しています」のままだった

## 次にやること

1. **`npm run deploy` で本番へ反映する**（上の「未検証のもの」のコマンド）
2. 反映を curl で確認したら、GSC の親プロパティにサイトマップを送信する
3. **アプリ側の続きは README / CLAUDE.md / `git log` から読み直すこと。**
   このセッションは SEO の入口しか触っていないので、機能の進捗はここには書かれていない

## 触ってはいけないところ

- **`src/lib/site.ts` の `SITE_URL` と `wrangler.jsonc` の `APP_URL` は同じ値に保つ。**
  片方だけ変えると sitemap/robots が別ドメインを指す
- **`INDEXABLE_PATHS` に認証系のパスを足さないこと。** `robots.txt` の Disallow と
  矛盾したサイトマップになり、GSC に警告が出る
- **`sitemap.ts` / `robots.ts` の `export const dynamic = "force-static"` を外さない。**
  `output: "export"` では静的に解決できないとビルドが落ちる
