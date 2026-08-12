# サブプロジェクトA-3：不正対策とパスワード再設定 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アカウント量産と総当たりを塞ぎ、パスワードを忘れた人が自力で復旧できるようにする。**これが終わるまで認証APIを本番へ出さない。**

**Architecture:** Turnstile をサーバー側で検証してから登録を通す。レート制限は KV に日次カウンタを持ち、`KvStore` インターフェース越しに操作してテスト可能にする。パスワード再設定は Resend で送るリンク方式（生トークンはメールにだけ載せ、D1 にはハッシュを保存）。

**Tech Stack:** Cloudflare Workers / D1 / KV / Turnstile / Resend / Vitest 4

## Global Constraints

- 設計の正は `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` **§5.4 / §5.3.2**
- **UI は作らない**（A-4）。完了確認は `curl` によるAPI疎通まで
- Worker のコードから `@/` エイリアスを使わない（`worker/tsconfig.json` の `"paths": {}` が強制）
- **`src/lib/lifeplan/` `src/components/` を変更しない**
- **`worker/worker-configuration.d.ts` を直接編集しない**（`wrangler types` の生成物）
- 既存テスト301件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **`git add` は変更したファイルを明示的に列挙する。`git add -A` は使わない**
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる
- **push とデプロイはしない。** 制御側が行う

### 確保済みリソース

| | 値 |
|---|---|
| Turnstile サイトキー | `0x4AAAAAAENnTBKLgFfFwJKa`（公開値） |
| Turnstile シークレット | **未投入。** 制御側が `wrangler secret put TURNSTILE_SECRET_KEY` で入れる |
| KV 名前空間 | `RATE_LIMIT` / id `9dd830bf032343e6a9513a1fd5ed4a28` |
| `RESEND_API_KEY` | ✅ 投入済み |
| `MAIL_FROM` | `ライフプランシミュレーター <noreply@nexeed-lab.com>`（`vars` に平文で置く） |

### メール送信は Resend で確定（Cloudflare Email Service に乗り換えない）

設計書 §5.3.2 が「A-3 の着手時に比較する」としていた件の結論。**Resend のまま進める。**

- `RESEND_API_KEY` は投入済みで、`nexeed-lab.com` は pre-meet で運用実績がある
- pre-meet に**REST を直接叩く実装がある**（SDK を足さない）。移植で済む
- Cloudflare Email Service に替えても外部APIキーが1本減るだけで、
  **ドメイン認証・配信性の担保という本質的な作業は同じ**。乗り換える利点が小さい

---

## File Structure

| ファイル | 責務 |
|---|---|
| `worker/rateLimit.ts`（新規） | KV の日次カウンタ。`KvStore` 抽象でテスト可能にする |
| `worker/rateLimit.test.ts`（新規） | 上記のテスト |
| `worker/turnstile.ts`（新規） | Turnstile の siteverify |
| `worker/turnstile.test.ts`（新規） | 上記のテスト |
| `worker/email.ts`（新規） | Resend の REST 呼び出し |
| `worker/email.test.ts`（新規） | 上記のテスト |
| `worker/auth/reset.ts`（新規） | パスワード再設定のハンドラ |
| `worker/auth/routes.ts`（変更） | signup に Turnstile＋レート制限、login にレート制限を足す |
| `worker/db.ts`（変更） | `password_resets` への読み書きを足す |
| `worker/index.ts`（変更） | 再設定のルートを配線 |
| `wrangler.jsonc`（変更） | KV バインディングを足す |

---

### Task 1: レート制限

**Files:** Create `worker/rateLimit.ts`, `worker/rateLimit.test.ts`

**Interfaces:**
- `KvStore` … `{ get(key): Promise<string|null>; put(key, value, opts?): Promise<void> }`
- `hashForKey(value: string): Promise<string>` … KVのキーに生のIP/メールを置かないための短縮ハッシュ
- `todayUtc(now?: Date): string` … `YYYYMMDD`
- `checkAndBump(kv: KvStore, key: string, limit: number, ttlSeconds?: number): Promise<boolean>`

**移植元:** `projects/pre-meet/apps/worker/src/guard.ts`。**考え方をそのまま使う。**

⚠️ **KV には原子的インクリメントが無い。** `get` → `put` で近似する。競合すると
カウントが1回分落ちることがあるが、**レート制限は「おおよそ」で機能すれば足りる**
（厳密な上限が要るのは金額であって回数ではない）。この割り切りをコメントに書くこと。

⚠️ **上限に達したときは加算しない。** 加算すると、拒否され続けている間もカウンタが
伸び続け、TTL が実質的に無限に延びる。

- [ ] **Step 1: 失敗するテストを書く**

`worker/rateLimit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkAndBump, hashForKey, todayUtc, type KvStore } from "./rateLimit";

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const puts: { key: string; value: string; ttl?: number }[] = [];
  const kv: KvStore = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, opts) {
      store.set(key, value);
      puts.push({ key, value, ttl: opts?.expirationTtl });
    },
  };
  return { kv, store, puts };
}

describe("todayUtc", () => {
  it("YYYYMMDD で返す", () => {
    expect(todayUtc(new Date("2026-08-12T23:59:59.000Z"))).toBe("20260812");
  });

  it("UTC基準で切る", () => {
    expect(todayUtc(new Date("2026-08-12T00:00:00.000Z"))).toBe("20260812");
  });
});

describe("hashForKey", () => {
  it("同じ入力なら同じ結果", async () => {
    expect(await hashForKey("1.2.3.4")).toBe(await hashForKey("1.2.3.4"));
  });

  it("違う入力なら違う結果", async () => {
    expect(await hashForKey("1.2.3.4")).not.toBe(await hashForKey("1.2.3.5"));
  });

  it("元の値を含まない（KVのキーに生IPを置かないため）", async () => {
    expect(await hashForKey("1.2.3.4")).not.toContain("1.2.3.4");
  });
});

describe("checkAndBump", () => {
  it("カウンタが無ければ通し、1にする", async () => {
    const { kv, store } = fakeKv();
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });

  it("上限未満なら通して加算する", async () => {
    const { kv, store } = fakeKv({ k: "2" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("3");
  });

  it("上限に達していたら拒否する", async () => {
    const { kv } = fakeKv({ k: "3" });
    expect(await checkAndBump(kv, "k", 3)).toBe(false);
  });

  it("拒否したときは加算しない（TTLが無限に延びるのを防ぐ）", async () => {
    const { kv, store, puts } = fakeKv({ k: "3" });
    await checkAndBump(kv, "k", 3);
    expect(store.get("k")).toBe("3");
    expect(puts).toHaveLength(0);
  });

  it("TTLを付けて保存する", async () => {
    const { kv, puts } = fakeKv();
    await checkAndBump(kv, "k", 3);
    expect(puts[0].ttl).toBeGreaterThan(0);
  });

  it("壊れた値は0として扱う", async () => {
    const { kv, store } = fakeKv({ k: "garbage" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });

  it("負の値も0として扱う", async () => {
    const { kv, store } = fakeKv({ k: "-5" });
    expect(await checkAndBump(kv, "k", 3)).toBe(true);
    expect(store.get("k")).toBe("1");
  });
});
```

- [ ] **Step 2: 失敗を確認する** — `npx vitest run worker/rateLimit.test.ts`
- [ ] **Step 3: 実装する** — pre-meet の `guard.ts` を参考に書く
- [ ] **Step 4: 成功を確認する** — 13件 PASS
- [ ] **Step 5: コミット** — `feat: KVによる日次レート制限`

---

### Task 2: Turnstile の検証

**Files:** Create `worker/turnstile.ts`, `worker/turnstile.test.ts`

**Interfaces:** `verifyTurnstile(token: unknown, secret: string, remoteIp?: string): Promise<boolean>`

エンドポイント: `https://challenges.cloudflare.com/turnstile/v0/siteverify`（POST、`secret` と `response` を送る）

⚠️ **`fetch` をテストから差し替えられる形にすること。** 実際に外部へ出るとテストが
ネットワークに依存する。引数で `fetch` 実装を受け取るか、モジュールとして注入する。

⚠️ **検証に失敗したら必ず false を返す。** ネットワークエラー・タイムアウト・
不正な応答形式のいずれでも `true` にしないこと。**ここが `true` に倒れると、
Turnstile を置いた意味が消える。**

- [ ] **Step 1: 失敗するテストを書く**

検証すべきこと:
- `success: true` の応答で `true`
- `success: false` の応答で `false`
- `fetch` が例外を投げたら `false`（**`true` にしない**）
- HTTPステータスが200以外なら `false`
- 応答のJSONが壊れていたら `false`
- トークンが文字列でなければ `fetch` を呼ばずに `false`
- 送信ボディに `secret` と `response` が入っている

- [ ] **Step 2〜5** — 実装・確認・コミット（`feat: Turnstile のサーバー側検証`）

---

### Task 3: Resend によるメール送信

**Files:** Create `worker/email.ts`, `worker/email.test.ts`

**Interfaces:** `sendPasswordResetMail(input: { to, token, expiresInMinutes, apiKey, from, appUrl, fetchImpl? }): Promise<void>`

**移植元:** `projects/pre-meet/apps/web/lib/email.ts`。**REST を直接叩く形をそのまま使う**（SDK を足さない）。

⚠️ **エラー本文にメールアドレスを載せないこと。** pre-meet のコメントにあるとおり、
Resend の応答をそのまま投げると外へ漏れうる。ステータスコードだけを含める。

⚠️ **`fetch` を差し替えられる形にすること。** テストが実際にメールを送ってはいけない。

- [ ] **Step 1: 失敗するテストを書く**

検証すべきこと:
- 正しいエンドポイント・`Authorization: Bearer <apiKey>` で POST する
- 本文に再設定リンク（`appUrl` + `/reset-password?token=...`）が入る
- トークンがURLエンコードされている
- 有効期限（分）が本文に入る
- 失敗時に例外を投げる。**その例外メッセージに宛先メールアドレスが含まれない**
- `from` が指定どおり使われる

- [ ] **Step 2〜5** — 実装・確認・コミット（`feat: Resend によるパスワード再設定メール`）

---

### Task 4: signup と login への適用

**Files:** Modify `worker/auth/routes.ts`, `wrangler.jsonc`

**やること:**

1. `wrangler.jsonc` に KV バインディングを足す

```jsonc
  "kv_namespaces": [
    { "binding": "RATE_LIMIT", "id": "9dd830bf032343e6a9513a1fd5ed4a28" }
  ],
```

2. `wrangler types` を再生成し、`worker/env.ts` の `AppEnv` に `TURNSTILE_SECRET_KEY: string` を足す

3. **signup**: Turnstile 検証 → IP別レート制限 → 既存の処理

4. **login**: IP別レート制限 → 既存の処理

**上限値（設計書 §7.1 の考え方に合わせる）:**

| 対象 | 上限 |
|---|---|
| 登録（IP別・1日） | **10回** |
| ログイン（IP別・1日） | **30回** |

IPは `request.headers.get("cf-connecting-ip")` から取る。**取れない場合は制限をかけない**
（ローカル開発で常に弾かれるのを避ける）。ただし**その旨をコメントに書く**こと。

**必ず守ること:**

- **Turnstile の検証は、D1 に触る前に行う。** 後にすると、検証を通らないリクエストでも
  DB負荷をかけられる
- **レート制限に引っかかったときの応答は `429`** とし、コードは `RATE_LIMITED`。
  **理由（IP超過なのか何なのか）を応答に含めない**
- **既存の不変条件を壊さないこと。** 特に login の2ケースが同一応答であることと、
  `Secure` がホスト名で決まること。`worker/auth/routes.test.ts` の既存14件が守っている

- [ ] **Step 1: 既存テストが通ることを先に確認する** — `npx vitest run worker/auth/routes.test.ts`
- [ ] **Step 2: 実装する**
- [ ] **Step 3: テストを追加する**

- Turnstile が失敗したら `403` になり、**`users` に行が増えない**こと
- レート制限を超えたら `429` / `RATE_LIMITED` になること
- **レート制限の応答に理由が含まれない**こと
- `cf-connecting-ip` が無いときに制限がかからないこと

- [ ] **Step 4: 全テストを確認する** — 既存14件を含めて全通過
- [ ] **Step 5: コミット** — `feat: 登録とログインに Turnstile とレート制限を適用`

---

### Task 5: パスワード再設定

**Files:** Create `worker/auth/reset.ts`; Modify `worker/db.ts`, `worker/index.ts`

**Interfaces（`worker/db.ts` に追加）:**
- `createPasswordReset(db, { tokenHash, userId, expiresAt }): Promise<void>`
- `consumePasswordReset(db, tokenHash, now): Promise<string | null>` — 有効なら `userId` を返し、**同時に使用済みにする**
- `updatePasswordHash(db, userId, passwordHash): Promise<void>`
- `deleteAllSessionsForUser(db, userId): Promise<void>`

**ルート:**

| ルート | 動作 |
|---|---|
| `POST /api/auth/forgot-password` | メールを正規化 → レート制限 → ユーザーがいればトークンを作ってメール送信。**常に同じ応答を返す** |
| `POST /api/auth/reset-password` | トークンを消費し、新しい鍵を保存し、**そのユーザーの全セッションを消す** |

**必ず守ること:**

- **`forgot-password` は常に `200 { ok: true }` を返す。** アドレスが登録済みかどうかで
  応答を変えない。**メール送信に失敗しても応答を変えない**（原因は `console.error` にだけ残す）
- **レート制限はアドレスの有無に関わらず消費する。** 「登録済みのときだけ枠を使う」形にすると、
  **残り回数の差から存在が漏れる**
- **`consumePasswordReset` は使用済みにするのと同時に検証する。** 先に検証して後で
  使用済みにすると、同じトークンを2回使える窓ができる
- **再設定に成功したら全セッションを消す。** パスワードを変える動機は「乗っ取られたかも」で
  あることが多く、既存セッションが生き残ると意味がない
- **再設定後に自動ログインしない。** 新しいパスワードで入り直してもらう
- 有効期限は **30分**

- [ ] **Step 1〜5** — テスト先行で実装。**`consumePasswordReset` が2回目で `null` を返すこと**を必ずテストする
- コミット — `feat: パスワード再設定`

---

### Task 6: 本番デプロイと疎通確認

**これは制御側（私）が行う。** 実装者はここまで。

1. `wrangler secret put TURNSTILE_SECRET_KEY`（ユーザーに依頼）
2. `npm run deploy`
3. `/api/auth/signup` が Turnstile 無しで `403` になること
4. レート制限が効くこと
5. パスワード再設定のメールが実際に届くこと

---

## Self-Review

**1. 仕様カバレッジ**

| 設計書 | タスク |
|---|---|
| §5.4 Turnstile | Task 2・4 |
| §5.4 KV でIP別の試行回数制限 | Task 1・4 |
| §5.4 メールの正規化と一意制約 | A-2 で完了済み |
| §5.3.2 Resend | Task 3・5 |
| §7.3 `/privacy` の書き換え | **A-3 の範囲外。** サブプロジェクトD |

**2. 意図的に除外したもの**

- UI（A-4）
- Stripe（B）
- `/privacy` の書き換え（D）。**ただし D が終わるまで課金を受け付けない**

**3. リスク**

- **Turnstile のシークレット未投入**。Task 4 の実装は進められるが、Task 6 の疎通確認には要る
- `wrangler types` の再生成で既存の型検査が壊れる可能性。A-2 で一度経験しているので同じ手順で対処する
