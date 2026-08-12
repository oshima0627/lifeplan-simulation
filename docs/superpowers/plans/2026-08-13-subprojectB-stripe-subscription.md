# サブプロジェクト B: Stripe 月額サブスクリプション 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development か
> superpowers:executing-plans でタスク単位に実装する。手順は `- [ ]` で追跡する。

**Goal:** AI アドバイス機能の利用権を、月額 1,980 円の Stripe サブスクリプションで管理する。

**Architecture:** Stripe Checkout（`mode: "subscription"`）で契約し、Webhook で契約状態を
D1 に**ミラー**する。判定は常に D1 を読む（Stripe API を同期的に叩かない）。
利用回数は `ai_usage` に月次で持ち、契約者は月100回、未契約の登録者は月1回。

**Tech Stack:** Cloudflare Workers / D1 / Stripe Node SDK（fetch + SubtleCrypto 版）

---

## Global Constraints

- **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` は `wrangler secret put` のみ。**
  `wrangler.jsonc` の `vars` にも `.dev.vars` のコミット対象にも絶対に書かない。
  `NEXT_PUBLIC_*` にしない。
- **価格は 1,980 円/月。金額をコードに書かない** — Stripe の Price ID を参照する。
  `STRIPE_PRICE_ID` は公開されても害が無いので `vars` に置く。
- **Webhook は署名検証必須。** 検証を通らないリクエストで契約状態を書き換えない。
- **`worker/` から `src/` を import しない**（`worker/tsconfig.json` の `"paths": {}` が強制）。
- **家計情報を D1 に入れない**（設計書 §5.3）。Stripe の metadata にも入れない。
- コメントは日本語。**なぜそうしているか**を書く。
- `npm run typecheck` はルートと `worker/` の2構成を通すこと。

---

## Stripe SDK の Workers 固有の落とし穴（姉妹プロジェクト pre-meet で解決済み）

**3つとも踏むと本番でだけ壊れる。** ローカルの Node では再現しない。

1. **HTTP クライアント** — 既定は Node の http モジュールで、Workers では接続に失敗する。
   `new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })` にする。
2. **署名検証** — 同期版 `constructEvent` は Node の crypto に依存する。
   `await stripe.webhooks.constructEventAsync(raw, sig, secret, undefined,
   Stripe.createSubtleCryptoProvider())` を使う。
3. **生ボディ** — `await req.text()` だとマルチバイトを含むイベントで署名がズレる。
   `await request.arrayBuffer()` のバイト列をそのまま渡し、デコードは SDK に任せる。

---

## この計画で新しく効かせる不変条件

**Stripe の Webhook は順序を保証しない。** `subscription.updated`（解約）が
`subscription.created`（契約）より先に届くことが実際に起きる。素直に上書きすると
解約済みの人が契約中に戻る。`subscriptions.last_event_created` に `event.created` を
持ち、**古いイベントでは更新しない**ことで防ぐ。

**Webhook は再送される。** `stripe_events` に `INSERT OR IGNORE` して
`meta.changes > 0` の時だけ処理する（`d1.ts` の `createUser` と同じ作法）。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `d1/migrations/0002_billing.sql` | `subscriptions` / `ai_usage` / `stripe_events` |
| `worker/billing/stripe.ts` | Stripe クライアント生成。上記3つの落とし穴をここに閉じ込める |
| `worker/billing/db.ts` | 契約状態と利用回数の読み書き。SQL をここから出さない |
| `worker/billing/webhook.ts` | 署名検証 → 冪等性 → 順序ガード → ミラー |
| `worker/billing/routes.ts` | `/api/billing/checkout` `/portal` `/status` |
| `worker/billing/entitlement.ts` | 「使ってよいか」の唯一の判定。AI 層（C）はここだけを呼ぶ |
| `src/lib/billing/client.ts` | ブラウザ側の呼び出し（`safeFetch` 経由） |
| `src/components/billing/*` | 料金導線・契約状態の表示 |

---

## Task 1: 課金スキーマ

**Files:**
- Create: `d1/migrations/0002_billing.sql`

- [ ] **Step 1: マイグレーションを書く**

```sql
-- 課金と利用回数（設計書 §9）。家計情報はここにも入れない。

-- Stripe の契約状態のミラー。判定は常にこの表を読む。
-- Stripe API を同期的に叩くと、Stripe が落ちた時に自社サービスも落ちる。
CREATE TABLE subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id),
  stripe_customer_id     TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  -- Stripe の status をそのまま持つ（active / trialing / past_due / canceled 等）。
  -- 独自の語彙に翻訳すると、Stripe 側が状態を増やした時に黙って誤判定する
  status                 TEXT NOT NULL,
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  -- ⚠️ Webhook は順序を保証しない。解約イベントが契約イベントより先に届くと
  -- 素直な上書きでは解約済みが契約中に戻る。event.created(秒) を持ち、
  -- これ以前のイベントでは更新しない
  last_event_created     INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_customer ON subscriptions(stripe_customer_id);

-- 月次の利用回数。period は UTC の 'YYYY-MM'。
-- 月初にリセットするバッチを持たずに済むよう、期間をキーに含める
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  period  TEXT NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- Webhook の冪等性。Stripe は同じイベントを再送する
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
```

- [ ] **Step 2: ローカルとリモートに適用**

```bash
npx wrangler d1 execute lifeplan --local --file=d1/migrations/0002_billing.sql
```

- [ ] **Step 3: コミット**

---

## Task 2: Stripe クライアント（落とし穴の封じ込め）

**Files:**
- Create: `worker/billing/stripe.ts`, `worker/billing/stripe.test.ts`
- Modify: `package.json`（`stripe` を dependencies に）, `worker/env.ts`

**Interfaces:**
- Produces: `getStripe(env: AppEnv): Stripe`

- [ ] **Step 1: 依存を入れる** — `npm i stripe`
- [ ] **Step 2: 失敗するテストを書く** — キー未設定で `getStripe` が投げること、
  返り値の `_api.httpClient` が fetch 版であること
- [ ] **Step 3: 実装**

```ts
import Stripe from "stripe";
import type { AppEnv } from "../env";

export function getStripe(env: AppEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY が未設定です");
  // Workers には Node の http が無く、既定のクライアントでは接続に失敗する。
  // ローカルの Node では再現しないため、明示指定を外すと本番でだけ壊れる
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
```

- [ ] **Step 4: `AppEnv` に `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` を足す**
  （`STRIPE_PRICE_ID` は `vars` なので `wrangler types` の生成物に出る。ここでは再宣言しない）
- [ ] **Step 5: テストを通す → コミット**

---

## Task 3: 課金の DB 層

**Files:**
- Create: `worker/billing/db.ts`, `worker/billing/db.test.ts`

**Interfaces:**
- Produces:
  - `findSubscriptionByUser(db, userId): Promise<SubscriptionRow | null>`
  - `findUserIdByCustomer(db, customerId): Promise<string | null>`
  - `upsertSubscription(db, row): Promise<boolean>` — 順序ガードを含む。更新した時 true
  - `markStripeEventSeen(db, eventId): Promise<boolean>` — 初回だけ true
  - `getUsage(db, userId, period): Promise<number>`
  - `bumpUsage(db, userId, period, limit): Promise<boolean>` — 上限未満の時だけ加算して true

- [ ] **Step 1: 失敗するテストを書く**（順序ガードと上限の2点が要）

```ts
it("古いイベントでは契約状態を更新しない", async () => {
  await upsertSubscription(db, { ...base, status: "active", lastEventCreated: 200 });
  const updated = await upsertSubscription(db, { ...base, status: "canceled", lastEventCreated: 100 });
  expect(updated).toBe(false);
  expect((await findSubscriptionByUser(db, "u1"))?.status).toBe("active");
});

it("上限に達したら加算しない", async () => {
  for (let i = 0; i < 3; i++) expect(await bumpUsage(db, "u1", "2026-08", 3)).toBe(true);
  expect(await bumpUsage(db, "u1", "2026-08", 3)).toBe(false);
  expect(await getUsage(db, "u1", "2026-08")).toBe(3);
});
```

- [ ] **Step 2: 実装。**「読んでから書く」を単一 SQL に畳む
  （分けて await すると二重加算する。pre-meet の CLAUDE.md の教訓）

```sql
-- bumpUsage: 上限判定と加算を1文で行う。
-- SELECT してから UPDATE すると、同時リクエストで上限を超える
INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 1)
ON CONFLICT(user_id, period) DO UPDATE SET used = used + 1
WHERE used < ?;
```

```sql
-- upsertSubscription: 順序ガードも1文に入れる
INSERT INTO subscriptions (...) VALUES (...)
ON CONFLICT(user_id) DO UPDATE SET
  stripe_subscription_id = excluded.stripe_subscription_id,
  status = excluded.status,
  current_period_end = excluded.current_period_end,
  cancel_at_period_end = excluded.cancel_at_period_end,
  last_event_created = excluded.last_event_created,
  updated_at = excluded.updated_at
WHERE excluded.last_event_created >= subscriptions.last_event_created;
```

- [ ] **Step 3: テストを通す → コミット**

---

## Task 4: 利用権の判定

**Files:**
- Create: `worker/billing/entitlement.ts`, `worker/billing/entitlement.test.ts`

**Interfaces:**
- Produces: `resolveEntitlement(db, userId, now): Promise<Entitlement>`
  where `Entitlement = { paid: boolean; limit: number; used: number; remaining: number }`

**定数（設計書の合意値）:**

```ts
export const PAID_MONTHLY_LIMIT = 100;  // 契約者
export const FREE_MONTHLY_LIMIT = 1;    // 登録だけのお試し
// 契約中とみなす status。past_due を含めないのは、決済が通っていないため。
// incomplete も含めない（初回決済が完了していない）
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
```

- [ ] **Step 1: 失敗するテストを書く**
  - 契約なし → `limit === 1`
  - `status: "active"` → `limit === 100`
  - `status: "past_due"` → `limit === 1`（**課金が止まったら無料枠に落ちる**）
  - `status: "canceled"` だが `current_period_end` が未来 → `limit === 1`
    （解約後は期末まで使える設計にしない。Stripe 側が期末まで `active` を維持するため、
    `canceled` が来た時点で権利は無い）
- [ ] **Step 2: 実装 → テスト → コミット**

---

## Task 5: Webhook

**Files:**
- Create: `worker/billing/webhook.ts`, `worker/billing/webhook.test.ts`
- Modify: `worker/index.ts`

**Interfaces:**
- Produces: `handleStripeWebhook(request, env, url): Promise<Response | null>`

処理順（**この順序を変えない**）:
1. `POST /api/stripe/webhook` 以外は `null` を返す（他のルータに渡す）
2. `stripe-signature` ヘッダと `STRIPE_WEBHOOK_SECRET` が無ければ 400
3. `arrayBuffer()` の生バイトで `constructEventAsync`（失敗は 400）
4. `markStripeEventSeen` が false なら `{received:true}` 200 で即返す（再送）
5. イベント種別ごとにミラー
6. DB 失敗は 500（Stripe に再送させる。処理が冪等なので安全）

扱うイベント:

| イベント | すること |
| --- | --- |
| `checkout.session.completed` | `client_reference_id`（= userId）と customer を結び付ける |
| `customer.subscription.created` / `.updated` / `.deleted` | status・期末・解約予約をミラー |

- [ ] **Step 1: 失敗するテストを書く**
  - 署名なし → 400
  - 同じ event.id を2回 → 2回目は DB を触らない
  - `subscription.updated`(created=100) を `.created`(created=200) の後に → 状態が戻らない
- [ ] **Step 2: 実装**
- [ ] **Step 3: `worker/index.ts` に組み込む。**
  ⚠️ **`handleAuthRoute` より前**に置く（`/api/stripe/*` は認証を要求しない）
- [ ] **Step 4: テスト → コミット**

---

## Task 6: 課金 API

**Files:**
- Create: `worker/billing/routes.ts`, `worker/billing/routes.test.ts`
- Modify: `worker/index.ts`

| エンドポイント | 認証 | 返すもの |
| --- | --- | --- |
| `POST /api/billing/checkout` | 要 | `{ url }`（Checkout へ） |
| `POST /api/billing/portal` | 要 | `{ url }`（解約・カード変更） |
| `GET /api/billing/status` | 要 | `{ paid, limit, used, remaining, currentPeriodEnd, cancelAtPeriodEnd }` |

- [ ] **Step 1: 失敗するテストを書く** — 未認証は全て 401
- [ ] **Step 2: 実装**

```ts
// Checkout。金額はコードに書かず Price ID を渡す
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
  // Webhook で「誰の契約か」を復元する唯一の手掛かり。
  // metadata ではなくこれを使うのは、Checkout が確実に載せてくれるため
  client_reference_id: userId,
  // 2回目以降は既存の顧客に紐付ける（顧客が増殖するとポータルが破綻する）
  ...(customerId ? { customer: customerId } : {}),
  success_url: `${env.APP_URL}/account?checkout=success`,
  cancel_url: `${env.APP_URL}/account?checkout=cancel`,
});
```

⚠️ `env.APP_URL` を使う。`request.url` から組み立てない（`worker/env.ts` の警告参照）。

- [ ] **Step 3: レート制限をかける**（`checkout` は Stripe API を叩くので、
  未制限だと請求と DO の枠を食う）。`RATE_LIMITER` を認証と同じ作法で使う
- [ ] **Step 4: `worker/index.ts` に組み込む → テスト → コミット**

---

## Task 7: 画面

**Files:**
- Create: `src/lib/billing/client.ts`, `src/components/billing/PlanCard.tsx`
- Modify: `src/app/account/page.tsx`

- [ ] **Step 1: `client.ts`**（既存の `safeFetch` を使う。`credentials: "same-origin"`）
- [ ] **Step 2: `/account` に契約状態と「今月の残り回数」を出す**
- [ ] **Step 3: 未契約なら「登録する」、契約中なら「プランを管理」（ポータルへ）**
- [ ] **Step 4: テスト → コミット**

---

## Task 8: Stripe 側の設定と本番投入

- [ ] **Step 1: 商品と価格を作る**（**利用者本人の作業。私は Stripe の鍵に触れない**）
  - 商品「ライフプラン AI アドバイス」/ 定期・月額 1,980 円 / JPY
  - Price ID を `wrangler.jsonc` の `vars.STRIPE_PRICE_ID` に入れる
- [ ] **Step 2: Webhook エンドポイントを登録**
  - URL: `https://lifeplan.nexeed-lab.com/api/stripe/webhook`
  - イベント: `checkout.session.completed`, `customer.subscription.created`,
    `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] **Step 3: シークレットを投入**（本人が実行）

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

- [ ] **Step 4: Customer Portal を有効化**（Stripe ダッシュボード → 設定 → Billing）
- [ ] **Step 5: テストモードで通し、本番へ**
- [ ] **Step 6: デプロイ。**⚠️ デプロイ直後の 404/500 は伝播待ち。
  1分待って再試行してから原因を疑う（設計書 §12.3 / §12.4）

---

## D（法務）への申し送り

サブスクは**特定商取引法の表示項目が買い切りと違う**。
「自動更新であること」「解約方法と期限」「解約後いつまで使えるか」を明記する。
`docs/superpowers/specs/` の D で扱う。

---

## 実装後の記録（2026-08-13）

**Task 1〜7 は実装・テスト・本番デプロイまで完了。** 495テスト。
本番 D1 にも `0002_billing.sql` を適用済み（7テーブル）。
デプロイ Version `a9de7582-95d9-480d-a9df-d7396f2f54b8`。

### 計画から変えたところ

**`subscription.current_period_end` は存在しない。** Stripe の API 2025-03-31 以降、
期間は subscription **item** 側にある（SDK 22 / `2026-07-29.dahlia` の
`SubscriptionItems.d.ts:54` で確認）。計画のまま書いていたら型検査を通ったまま
常に undefined になり、期末が永久に null になっていた。
`subscription.items.data[].current_period_end` の最小値を採る。

**署名検証に `Buffer` は要らない。** SDK の `WebhookPayload = string | Uint8Array` なので
`new Uint8Array(await request.arrayBuffer())` を直接渡せる（pre-meet より1段簡単）。

### 本番で確認した挙動

| 対象 | 期待 | 実測 |
| --- | --- | --- |
| `GET /api/billing/status`（未認証） | 401 | 一致 |
| `POST /api/billing/checkout`（未認証） | 401 | 一致 |
| `POST /api/billing/status` | 405 | 一致 |
| `GET /api/stripe/webhook` | 405 | 一致 |
| `POST /api/stripe/webhook`（署名なし） | 400 | 一致 |

⚠️ 偽の署名を送っても `SIGNATURE_INVALID` ではなく `SIGNATURE_MISSING` が返る。
これは `STRIPE_WEBHOOK_SECRET` が未投入のため。**鍵が無い間は必ず弾く**（fail-closed）
という意図どおりの挙動で、鍵を入れれば `SIGNATURE_INVALID` に変わる。

### 実物で検証した SQL の意味論

ローカル D1（実 SQLite）で9項目を確認済み。特に:

- 古いイベント（created=100）が後着 → `changes=0`、status は `active` のまま
- 同一秒（`>=`）は通る
- 上限3で4回目の加算 → `changes=0`、最終値は 3

### テストの落とし穴

**`vi.fn()` の実装が投げた例外は、呼び出し側が正しく捕捉していても
vitest が未処理エラーとして拾いテストを落とす。** 同期 throw でも
`Promise.reject` + 空 `catch` でも回避できなかった。
**モックを包む素の関数側で投げる**と解消する（`webhook.test.ts` の
`signatureVerificationFails`）。切り分けには「戻り値を直接 console.log する」のが速い
（今回は status=400 が返っていることが分かった時点で、製品コードは無罪と確定した）。

### 残り（利用者本人の作業。私は Stripe の鍵に触れない）

Task 8 がそのまま残っている。**この4つが済むまで課金は動かない。**

1. Stripe で商品「AIアドバイス」/ 定期・月額 1,980円 / JPY を作る
2. その Price ID を `wrangler.jsonc` の `vars.STRIPE_PRICE_ID` に入れて再デプロイ
3. Webhook エンドポイント `https://lifeplan.nexeed-lab.com/api/stripe/webhook` を登録し、
   `checkout.session.completed` と `customer.subscription.created/updated/deleted` を選ぶ
4. `npx wrangler secret put STRIPE_SECRET_KEY` と
   `npx wrangler secret put STRIPE_WEBHOOK_SECRET` を実行
5. Stripe ダッシュボードで Customer Portal を有効化（解約導線がこれに依存する）

⚠️ `src/components/billing/PlanCard.tsx` の `MONTHLY_PRICE_JPY` は**表示専用**。
Stripe の Price を変えたら必ずここも直す。食い違うと表示と請求が違う状態になる。

### Task 8 を自動化した（2026-08-13）

Stripe の MCP はこの環境から使えなかった（遅延ツール検索・レジストリ検索・
インストール済みコネクタのいずれも0件）。代わりに `scripts/setup-stripe.mjs` を用意し、
ダッシュボードでの手作業を「カスタマーポータルの有効化」だけに減らした。

```bash
node scripts/setup-stripe.mjs
```

事前に `STRIPE_SECRET_KEY` を環境変数へ入れる（**テストモードの鍵から始める**）。
スクリプトは商品・価格・Webhook エンドポイントを作り、何度実行しても同じ状態になる。

**設計上の要点:**

- **JPY はゼロ十進通貨。** `unit_amount` は `1980`。`198000` と書くと100倍請求になる
- 再実行時の重複作成を防ぐため、名前ではなく `metadata`（`app=lifeplan` /
  `role=ai_advisor_monthly`）で既存を探す。名前で探すと手で改名した瞬間に二重作成される
- 購読イベントは `worker/billing/webhook.ts` が実際に処理する4つだけ。
  余計なイベントは、無視するだけのリクエストで DO の書き込み枠を食う
- **Webhook 署名シークレットは画面に出さず、`wrangler secret put` の標準入力へ直接流す。**
  目に見える場所に出さないことで貼り付け事故を防ぐ
- Webhook が**既に登録済み**の場合、署名シークレットは Stripe API から取り出せない
  （作成時にしか返らない）。勝手に消して作り直すと本番の課金が一時的に壊れるため、
  スクリプトは案内だけして手を出さない

### Stripe MCP で作ったもの（2026-08-13・テストモード）

接続先: `Nexeed Lab`（`acct_1TRR0pKTnrLfYvHy`）の**テストモード**。

| 種別 | ID |
| --- | --- |
| 商品 | `prod_V3s2k0nfIEpdaF` |
| 価格 | `price_1U3kIiKTnrLfYvHymjDohcMn`（1,980円 / 月・JPY・`tax_behavior: inclusive`） |

`tax_behavior` を `inclusive` にしたのは、画面に「月額 1,980円（税込）」と出しているため。
**一度設定すると変更できない。**

**⚠️ Price はモードごとに別物。** `wrangler.jsonc` に入っているのはテストの ID なので、
本番受付を始めるときは live の ID に差し替えて再デプロイする。

#### MCP で**やらなかった**こと

- **Webhook エンドポイント** — 作成レスポンスに署名シークレットが含まれ、会話の記録に残る。
  漏れると偽のイベントで「契約中」を偽造できるため、`scripts/setup-stripe.mjs` から作る
  （シークレットは画面に出さず `wrangler secret put` の標準入力へ直接流す）
- **カスタマーポータルの設定** — この MCP は `GET /v1/billing_portal/configurations` しか
  公開しておらず、作成できなかった。スクリプト側に実装した

  解約は **`at_period_end`**。`immediately` にすると、その月の料金を払っているのに
  即座に使えなくなるうえ、`worker/billing/entitlement.ts` の判定
  （`canceled` は権利なし / `active` + `cancel_at_period_end` は権利あり）とも食い違う。

#### 本番モードへ移す前に必要なもの

**利用規約（サブプロジェクト D）。** Stripe は本番モードのポータル有効化で
プライバシーポリシーと利用規約の両方の URL を求める。現在スクリプトは
プライバシーポリシーしか渡していないので、D が終わったら
`scripts/setup-stripe.mjs` の `business_profile` に `terms_of_service_url` を足す。
