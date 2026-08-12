# サブプロジェクトA-3.5：レート制限を Durable Objects へ移す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 課金せずに、レート制限の書き込み枠を100倍にし、同時にカウントの取りこぼしを無くす。

**Architecture:** KV の日次カウンタを Durable Objects（SQLiteバックエンド）へ移す。呼び出し側のインターフェース（`checkAndBump`）は保つ。

**Tech Stack:** Cloudflare Workers / Durable Objects (SQLite) / TypeScript / Vitest 4

## なぜやるか

**Workers Free の KV は 1,000 writes/日。** 1IPあたり signup 10 + login 30 + forgot 60 + reset 60 ≈ 160 書き込みできるため、**7IPほどで当日枠が尽き、`/api/auth/*` が丸ごと 500 になる。**

**Durable Objects の無料枠は 100,000 rows written/日**（ユーザーのCloudflareダッシュボードのプラン表で確認済み）。**100倍の余裕がある。**

さらに **Durable Objects は同一オブジェクトへのリクエストが直列化される**ため、read→write が構造的に原子的になる。現在 `worker/rateLimit.ts` が
「KVには原子的インクリメントが無いので get→put で近似する。競合するとカウントが1回分落ちる」
と割り切っている問題が、**移行の副産物として消える。**

**つまり、課金しないほうが正しい実装になる。**

## Global Constraints

- **課金プランへの変更を前提にしない。** すべて Workers Free の枠内で完結させる
- **無料枠のDOは SQLite バックエンド必須。** `migrations` の `new_sqlite_classes` で宣言する
  （`new_classes` は旧来のKVバックエンドで、無料枠では使えない）
- **`checkAndBump` のシグネチャを変えない。** 呼び出し側（`worker/auth/routes.ts` / `worker/auth/reset.ts`）の変更を最小にする
- `worker/` から `src/` を import しない
- **`src/` 以下と `shared/` を変更しない**
- 既存テスト387件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **`git add` は変更したファイルを明示的に列挙する。`git add -A` は使わない**
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる
- **push とデプロイはしない。** 制御側が行う

### Cloudflare 公式のベストプラクティス（`durable-objects` / `workers-best-practices` スキルより）

| 必ず守ること | 理由 |
|---|---|
| **`extends DurableObject`**（`implements` ではない） | `implements` だと `this.ctx` / `this.env` が使えない |
| **`this.env` を使う**（`env` を直接参照しない） | 基底クラスの規約 |
| `ctx` を分割代入しない | `this` が外れて実行時エラーになる |
| 浮いた Promise を作らない | すべて `await` / `return` / `void` |

---

## File Structure

| ファイル | 責務 |
|---|---|
| `worker/rateLimitDo.ts`（新規） | Durable Object クラス `RateLimiter`。SQLite に日次カウンタを持つ |
| `worker/rateLimitDo.test.ts`（新規） | 上記のテスト |
| `worker/rateLimit.ts`（変更） | `checkAndBump` の中身を DO 呼び出しに差し替える。`hashForKey` / `todayUtc` / `toRateLimitIdentity` はそのまま |
| `worker/rateLimit.test.ts`（変更） | `KvStore` を使ったテストを DO スタブに置き換える |
| `worker/auth/routes.ts` / `worker/auth/reset.ts`（変更） | `env.RATE_LIMIT`（KV）→ `env.RATE_LIMITER`（DO）に差し替え。**それ以外は変えない** |
| `wrangler.jsonc`（変更） | DO バインディングと `migrations` を追加。**KV バインディングは残す**（後述） |
| `worker/index.ts`（変更） | DO クラスを export する（Workers の要件） |

**KV バインディングを残す理由:** いま `RATE_LIMIT` に入っているカウンタは当日中だけ有効で、
翌日には無意味になる。**移行のために移し替える必要はない。** ただし
バインディングを即削除すると、デプロイの瞬間に「旧コードが動いている数秒」で
参照エラーになりうる。**このサブプロジェクトでは残し、B の着手時に削除する。**

---

### Task 1: Durable Object クラス

**Files:** Create `worker/rateLimitDo.ts`, `worker/rateLimitDo.test.ts`

**Interfaces:**
- `export class RateLimiter extends DurableObject`
- メソッド: `checkAndBump(key: string, limit: number, ttlSeconds: number): Promise<boolean>`

**設計:**

- **DOのインスタンスは識別子ごとに1つ**（`idFromName(identity)`）。IPごと・メールごとに別のオブジェクトになるので、**互いに待たされない**
- 1つのDOの中に、スコープ（`signup` / `login` など）ごとの行を持つ
- **日付が変わったらカウントを0に戻す**（行を消さずに `date` 列を見て判定する）
- **上限に達したときは加算しない**（KV版と同じ。加算するとTTLが実質無限に延びる）
- **`ctx.storage.setAlarm` で最終利用から48時間後に `deleteAll()` する。** 放置するとIPの数だけDOが増え続ける

```ts
import { DurableObject } from "cloudflare:workers";

/**
 * レート制限のカウンタ。識別子（IPやメールのハッシュ）ごとに1インスタンス。
 *
 * なぜ KV ではなく Durable Objects か:
 * 1. **無料枠の書き込みが100倍。** KV は 1,000 writes/日、DO は 100,000 rows written/日。
 *    KV のままだと 1IP あたり約160書き込みできるため、7IPほどで枠が尽き
 *    /api/auth/* が丸ごと 500 になる
 * 2. **原子的になる。** 同一DOへのリクエストは直列化されるので read→write の間に
 *    割り込まれない。KV 版が「競合するとカウントが1回分落ちる」と割り切っていた
 *    問題が構造的に消える
 *
 * ⚠️ 無料枠では SQLite バックエンドが必須。wrangler の migrations で
 * `new_sqlite_classes` として宣言すること（`new_classes` は旧来のKVバックエンド）
 */
export class RateLimiter extends DurableObject {
  ...
}
```

- [ ] **Step 1: 失敗するテストを書く**

`worker/rateLimitDo.test.ts` を作る。**DOの実行環境は Vitest の node には無い**ので、
`DurableObjectState` 相当を**自分でスタブして**クラスを直接 `new` してテストする。

⚠️ **スタブは実物の契約を模すこと。** `ctx.storage.sql.exec(...)` の戻り値の形（`.toArray()` / `.one()` 等）を
使うなら、スタブもその形で返すこと。**スタブが甘いと「テストは通るが本番で落ちる」状態になる。**

検証すること:

- カウンタが無ければ通し、1にする
- 上限未満なら通して加算する
- **上限に達していたら拒否し、加算しない**
- **日付が変わったらカウントが0に戻る**
- **スコープが違えば独立して数える**（`signup` と `login` が干渉しない）
- 壊れた値・負の値を0として扱う
- `setAlarm` が呼ばれる（TTLの延長）
- `alarm()` が `deleteAll()` を呼ぶ

- [ ] **Step 2: 失敗を確認する** — `npx vitest run worker/rateLimitDo.test.ts`
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 成功を確認する**
- [ ] **Step 5: コミット** — `feat: レート制限のDurable Object`

---

### Task 2: 呼び出し側の差し替え

**Files:** Modify `worker/rateLimit.ts`, `worker/rateLimit.test.ts`, `worker/auth/routes.ts`, `worker/auth/reset.ts`, `worker/index.ts`, `wrangler.jsonc`

- [ ] **Step 1: `wrangler.jsonc` に DO を足す**

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiter" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      // ⚠️ 無料枠では SQLite バックエンドが必須。new_classes ではない
      "new_sqlite_classes": ["RateLimiter"]
    }
  ],
```

**`kv_namespaces` の `RATE_LIMIT` は残すこと**（理由は File Structure 参照）。

- [ ] **Step 2: `worker/index.ts` から DO クラスを export する**

```ts
export { RateLimiter } from "./rateLimitDo";
```

⚠️ **これが無いと `Class "RateLimiter" not found` でデプロイが失敗する。**

- [ ] **Step 3: `wrangler types` を再生成する** — `npm run cf:typegen`

- [ ] **Step 4: `worker/rateLimit.ts` の `checkAndBump` を差し替える**

**シグネチャは変えない。** 第1引数だけ `KvStore` から DO の Namespace に変える。

```ts
export async function checkAndBump(
  ns: DurableObjectNamespace<RateLimiter>,
  key: string,
  limit: number,
  ttlSeconds = RATE_LIMIT_TTL_SECONDS,
): Promise<boolean> {
  // 識別子ごとに別インスタンスにする。IPごと・メールごとに独立するので
  // 互いに待たされない
  const stub = ns.get(ns.idFromName(key));
  return stub.checkAndBump(key, limit, ttlSeconds);
}
```

**`hashForKey` / `todayUtc` / `toRateLimitIdentity` は変更しない。**
特に `toRateLimitIdentity` の IPv6 /64 丸めは、**レビューで実測検証済みの重要なガード**なので触らない。

- [ ] **Step 5: 呼び出し側を差し替える**

`worker/auth/routes.ts` と `worker/auth/reset.ts` で `env.RATE_LIMIT` → `env.RATE_LIMITER` に変える。
**それ以外のロジックは1行も変えない。**

⚠️ **既存の不変条件を壊さないこと。** 着手前に必ず実行して全通過を確認する:

```bash
npx vitest run worker/auth/routes.test.ts worker/auth/reset.test.ts
```

守られている性質:

- login の2ケース（ユーザー不在／鍵違い）が**文言・ステータス・ヘッダとも完全に同一**
- `forgot-password` が常に `200 { ok: true }`
- **IP上限を超えたらメール別カウンタを消費しない**（`ipAllowed ? ... : false`）
- 登録済みのときだけ `ctx.waitUntil` が呼ばれる
- `Secure` がホスト名で決まる
- 全応答に `cache-control: no-store`

- [ ] **Step 6: テストのスタブを差し替える**

`worker/rateLimit.test.ts` の `fakeKv` を、**DO Namespace のスタブ**に置き換える。
`worker/auth/routes.test.ts` / `reset.test.ts` にも KV のスタブがあるので同様に。

⚠️ **テストの主張内容を弱めないこと。** 特に「IP上限超過後にメール別カウンタが増えない」
（1IPからKV書き込みを無制限にできた欠陥への対策）を検証しているテストは、
DO版でも同じ性質を主張する形に書き換えること。

- [ ] **Step 7: 全テストを確認してコミット** — `feat: レート制限をKVからDurable Objectsへ移す`

---

### Task 3: WAFルールとデプロイ

**これは制御側（私）が行う。** 実装者はここまで。

1. Cloudflare ダッシュボードで WAF レート制限ルールを作成
   - Freeプランは **1ルール・10秒窓・パス一致**（公式ドキュメントで確認済み）
   - `/api/auth/*` に対して 10リクエスト/10秒/IP
   - **エッジで弾かれるので Worker 実行も DO 書き込みも消費しない**
2. `npm run deploy`
3. 本番で実測
   - レート制限が引き続き効くこと（429が返る）
   - 既存の認証フローが壊れていないこと
   - **DO が実際に使われていること**（KVの書き込みが増えていないこと）

---

## Self-Review

**1. この移行で何が良くなるか**

| | 移行前（KV） | 移行後（DO） |
|---|---|---|
| 無料枠の書き込み | 1,000 / 日 | **100,000 / 日** |
| 原子性 | 無い（get→put で近似、競合で取りこぼし） | **ある**（同一DOは直列化） |
| 枯渇までのIP数 | 約7 | **約700** |

**2. リスク**

- **DO クラスの export 忘れでデプロイが失敗する**（Task 2 Step 2 に明記）
- **`new_classes` と `new_sqlite_classes` の取り違え。** 無料枠では SQLite 必須
- テストのスタブが実物の契約とズレると「テストは通るが本番で落ちる」

**3. 意図的にやらないこと**

- **KVに残っている当日分のカウンタを移行しない。** 翌日には無意味になる値なので移す価値がない
- **`kv_namespaces` の削除。** デプロイの瞬間の参照エラーを避けるため B まで残す
- **`toRateLimitIdentity` の変更。** IPv6 /64 丸めは実測検証済みのガード
