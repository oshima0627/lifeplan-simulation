# ライフプランシミュレーター

年齢・収支・家族構成から将来の資産推移を試算し、**資産が何歳で尽きるか**を
楽観・普通・悲観の3シナリオで可視化するWebサイト。

- 要件定義: [docs/requirements.md](docs/requirements.md)
- 実装計画: [docs/plans/](docs/plans/)

## 開発

```bash
npm install
npm run dev        # 開発サーバー (http://localhost:3000)
npm test           # 計算エンジンのユニットテスト (Vitest)
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run build      # 本番ビルド（静的エクスポート → out/）
```

## デプロイ（Cloudflare Workers）

静的エクスポートした `out/` を Cloudflare Workers（Static Assets）で配信する。
設定は [wrangler.jsonc](wrangler.jsonc)。

```bash
npx wrangler login   # 初回のみ（または CLOUDFLARE_API_TOKEN を設定）
npm run deploy       # next build && wrangler deploy
npm run preview      # ローカルでCloudflare配信を再現（wrangler dev）
```

## 構成

| ディレクトリ | 内容 |
|---|---|
| `src/lib/lifeplan/` | 計算エンジン（UI非依存の純粋関数・テスト必須） |
| `src/constants/` | 寿命・3シナリオの前提値・教育費テーブル。**統計や制度が変わったらここだけ直す** |
| `src/lib/storage.ts` | 入力内容の localStorage 保存 |
| `src/components/` | UIコンポーネント |
| `src/app/` | ページ |

## 計算仕様

詳細は [docs/requirements.md §5](docs/requirements.md)。要点:

- 現在年齢から**95歳**までを1年刻みで試算する
- **貯金には利回りを適用せず、投資にのみ適用する。** 1本にまとめると資産推移を過大評価する
- 赤字はまず貯金から取り崩し、貯金が尽きてから投資に手を付ける
- インフレ率は支出に、昇給率は給与に、利回りは投資に適用する（名目）
- 教育費は文部科学省「令和5年度 子供の学習費調査」の**2026年1月16日訂正版**を使用。
  初回公表値がネット上に多く残っているが誤りなので注意

## 現状

Phase 1（フォーム入力）まで実装済み。
Phase 2 でAIヒアリング層を載せる予定（[docs/requirements.md §3](docs/requirements.md)）。
