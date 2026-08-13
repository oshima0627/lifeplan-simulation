# サブプロジェクト E: プランの保存と履歴 実装計画

**Goal:** ログインしている人が試算を名前を付けて保存し、あとから一覧・復元・削除できるようにする。

**Architecture:** 保存するのは**入力（`HearingSheet`）だけ**。計算結果は保存しない。
結果は入力から再計算でき、エンジンを直したときに古い結果が残ると表示と実態が食い違うため。

---

## この計画で覆す前提

**設計書 §5.3 と `0001_init.sql` は「家計情報を D1 に保存しない」と決めていた。**
漏洩時の被害を認証情報だけに限定するためで、その方針でトップページと
プライバシーポリシーに「サーバーには送信されません」と明記して公開している。

**保存機能はこれを覆す。** 利用者本人の判断（2026-08-13）。
したがって**コードより先に、公開している約束の書き換えが要る**。
書き換えずに保存機能を出すと、書いてあることと実際の挙動が食い違う。

書き換える箇所:

- `src/app/page.tsx:17`「入力内容はお使いのブラウザにのみ保存され、サーバーには送信されません。」
- `src/app/privacy/page.tsx:23-24`「当サイトのサーバーに送信・保存されることはありません。」
- `d1/migrations/0001_init.sql` の冒頭コメント（新しい方針を追記する。過去の記述は消さない）

新しい約束は「**保存を押さないかぎりサーバーには送られない**」。
既定は今までどおりブラウザのみ、明示的な保存だけがサーバーへ行く。

---

## Global Constraints

- **D1 に RLS は無い。** 単一プランを触るクエリは**必ず `WHERE id = ? AND user_id = ?`**。
  `WHERE id = ?` だけで所有者確認を JS 側に置くと、書き忘れた瞬間に他人のプランが読める。
  これがこのサブプロジェクトで最も壊しやすい箇所。
- **1人あたりの保存件数と1件あたりのサイズに上限を置く。** 無制限だと D1 の枠を
  1人で使い切れる。上限は SQL 側でも効かせる。
- **`worker/` から `src/` を import しない。** 入力の検証は `shared/` に置いて両方から使う。
- **保存するのは `HearingSheet` のみ。** 計算結果・グラフ用の配列は保存しない。
- コメントは日本語。**なぜそうしているか**を書く。

---

## Task 1: スキーマ

**Files:** Create `d1/migrations/0003_plans.sql`

```sql
-- 保存されたプラン（サブプロジェクト E）。
--
-- ⚠️ 0001 の「家計情報を D1 に保存しない」という方針を、利用者本人の判断で覆している。
-- 代わりに「保存を押さないかぎり送らない」を新しい約束にした。
-- 既定は今までどおりブラウザのみ。

CREATE TABLE plans (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  -- 利用者が付ける名前。空なら画面側で日付を出す
  name       TEXT NOT NULL,
  -- HearingSheet の JSON。計算結果は入れない（入力から再計算できるため）
  sheet_json TEXT NOT NULL,
  -- 入力の形が将来変わったときに、古い行を見分けるため。
  -- これが無いと、項目を増やした後に古い行を読んで黙って壊れる
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 一覧は user_id で引き、更新の新しい順に出す
CREATE INDEX idx_plans_user ON plans(user_id, updated_at DESC);
```

- [ ] ローカルとリモートに適用 → コミット

---

## Task 2: 入力の検証（`shared/`）

**Files:** Create `shared/lifeplan/sheetValidation.ts` + テスト

**Interfaces:**
- `MAX_SHEET_BYTES = 8 * 1024`
- `parseStoredSheet(raw: string): unknown | null` — JSON として壊れていれば null
- `isStorableSheet(value: unknown): boolean` — Tier 1 の必須項目が数値・種別として揃っているか

**なぜ必要か:** ブラウザが唯一の書き込み元だが、認証済みの利用者が細工した
JSON をそのまま入れると、読み出してエンジンに渡した瞬間に壊れる。
**書き込む側で弾く**（読み出し時に毎回身構えるより安い）。

- [ ] 失敗するテスト → 実装 → コミット

---

## Task 3: DB 層

**Files:** Create `worker/plans/db.ts` + テスト

**Interfaces:**
- `listPlans(db, userId)` — `sheet_json` を返さない（一覧が重くなるため）
- `findPlan(db, userId, planId)` — **必ず user_id で絞る**
- `createPlan(db, {...}, maxPerUser)` — 上限を SQL 側で効かせる。超えたら false
- `updatePlan(db, userId, planId, {...})` — 更新できた時 true
- `deletePlan(db, userId, planId)`

**上限を SQL に畳む:**

```sql
-- 件数を数えてから INSERT すると、同時リクエストで上限を超える
INSERT INTO plans (id, user_id, name, sheet_json, schema_version, created_at, updated_at)
SELECT ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT COUNT(*) FROM plans WHERE user_id = ?) < ?;
```

- [ ] **必ず書くテスト:** 他人の `planId` を指定しても取得・更新・削除できないこと
- [ ] 上限に達したら `createPlan` が false を返すこと
- [ ] 実装 → コミット

---

## Task 4: API

**Files:** Create `worker/plans/routes.ts` + テスト、Modify `worker/index.ts`

| エンドポイント | 認証 | 返すもの |
| --- | --- | --- |
| `GET /api/plans` | 要 | `{ plans: [{id, name, createdAt, updatedAt}] }` |
| `POST /api/plans` | 要 | `{ id }`。上限超過は 409 |
| `GET /api/plans/{id}` | 要 | `{ id, name, sheet, ... }`。他人のものは 404 |
| `PUT /api/plans/{id}` | 要 | `{ ok: true }` |
| `DELETE /api/plans/{id}` | 要 | `{ ok: true }` |

**⚠️ 他人のプランは 403 ではなく 404 を返す。** 403 だと「その ID は存在する」と伝わる。

- [ ] 未認証はすべて 401 → 実装 → コミット

---

## Task 5: 画面

**Files:** Create `src/lib/plans/client.ts`, `src/components/plans/SavedPlans.tsx`
Modify `src/components/Simulator.tsx`, `src/app/account/page.tsx`

- [ ] 未ログインなら保存 UI を出さない（押してから 401 は不親切）
- [ ] 「この内容を保存」ボタン。名前は任意、既定は日付
- [ ] 一覧から「読み込む」で現在のフォームへ復元、「削除」
- [ ] **読み込みは現在の入力を上書きする。** 確認を挟む

---

## Task 6: 公開している約束の書き換え

**Files:** Modify `src/app/page.tsx`, `src/app/privacy/page.tsx`

- [ ] **コードより先に出さない。** 実装が本番に出る前にこの2箇所を直す
- [ ] 「保存を押さないかぎりサーバーには送られない」という書き方にする
- [ ] プライバシーポリシーに、保存した内容の削除方法を書く

---

## Task 7: 課金の導線を隠す

**Files:** Modify `src/app/account/page.tsx`

- [ ] `PlanCard` を描画しない。**コードとテーブルは消さない**（判断は保留のため）
- [ ] `worker/billing/` と Stripe の設定はそのまま残す

---

## 実装後の記録（2026-08-13）

**Task 1〜7 完了・本番稼働中。** 553テスト。Version `d1f74ac8-8234-49e3-acb3-7e5cd4bfc1bc`。
本番 D1 は8テーブル。

### 実物の SQLite で検証した SQL

`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?` が意図どおり動くことを
ローカル D1 で8項目確認した。

- 上限3件で4件目 → `changes = 0`
- 上限は**利用者ごとに独立**（他人が入れても自分の枠は減らない）
- 他人の `id` を指定しても **読めない・消せない**（`changes = 0`）
- 本人なら消せる

### 本番での実測

| 対象 | 期待 | 実測 |
| --- | --- | --- |
| `GET/POST /api/plans`（未認証） | 401 | 一致 |
| `GET/PUT/DELETE /api/plans/{id}`（未認証） | 401 | 一致 |
| `PATCH /api/plans`（未認証） | 401 | 一致 |
| `GET /api/plansfoo` | 404（ルータが拾わない） | 一致 |
| トップ・プライバシーの旧文言 | 0件 | 一致 |

**`PATCH` が 405 でなく 401 なのは意図どおり。** 認証をルータの入口で1回だけ行うため、
未認証の相手にはメソッドの有無すら教えない。405 を返すのは認証済みの場合だけ。

### デプロイ直後の 404 は3回目

`/api/plans` は 401 なのに `/api/plans/xyz` は 404、という**混在**が出た。
再確認したら待機0秒で正常だった。**§12.3・§12.4 に続き3回目。**
デプロイ直後の想定外の応答は、原因を探る前にまず再試行する。

### 意図的にやらなかったこと

- **暗号化しない**（利用者判断）。D1 に平文で入る。代わりに公開している約束を
  「保存を押したときだけ送る」に書き換えた
- **`0001_init.sql` は書き換えない。** 適用済みのマイグレーションは触らない。
  方針を覆したことは `0003_plans.sql` の冒頭に書いた
- **課金は消さない。** `worker/billing/`・`src/components/billing/`・Stripe の設定は
  すべて残し、`/account` から `<PlanCard />` を外しただけ。戻せば復活する
