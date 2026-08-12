# サブプロジェクトA-1：サーバー土台（Worker・D1・ルーティング）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在は静的アセット配信だけの Cloudflare Workers に、`/api/*` を処理する Worker と D1 データベースを追加し、**本番でルーティングが正しく効くことを実機で確認する。**

**Architecture:** `wrangler.jsonc` に `main` と `assets.binding`、そして `run_worker_first: ["/api/*"]` を追加する。Worker は `/api/*` だけを自分で処理し、それ以外は `env.ASSETS.fetch()` に委ねる。認証・課金のロジックはこの計画には含めず、疎通確認用の `/api/health` だけを作る。

**Tech Stack:** Cloudflare Workers / D1 / wrangler 4 / TypeScript / Vitest 4

## Global Constraints

- **認証・課金・AI のコードは1行も書かない。** この計画は土台だけ。`/api/health` 以外のエンドポイントを作らない
- **`src/` 以下の既存コードを変更しない。** Worker のコードは新しい `worker/` ディレクトリに置く
- Worker のコードから `@/` エイリアスを使わない。**相対パスで書く**（`@/` は Next のビルドにしか設定されておらず、wrangler のバンドルでは解決されない）
- 既存テスト210件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる

### ⚠️ この計画が塞ごうとしている罠（2026-08-12 に公式ドキュメントで確認済み）

`compatibility_date` が 2025-04-01 以降だと `assets_navigation_prefers_asset_serving` が
既定で有効になり、リクエストの評価順序はこうなる。

```
run_worker_first か？ → アセットに一致するか？ → Worker はあるか？ → ナビゲーションリクエストか？
```

**ナビゲーションリクエスト（アドレスバーへの直接入力・素のフォームPOST・外部からのリダイレクト着地）は
Worker を素通りして `404.html` が返る。** 一方 `fetch()` は Worker に届く。

当プロジェクトの `compatibility_date` は `2026-07-01` なので**該当する。**

つまり `run_worker_first` を書き忘れても、**JS からの `fetch()` で書いている限り動いてしまう。**
気づくのは決済プロバイダからのリダイレクトが404になったとき、つまり本番で課金が始まった後になる。

出典: <https://developers.cloudflare.com/workers/static-assets/routing/worker-script/>

---

## File Structure

| ファイル | 責務 |
|---|---|
| `wrangler.jsonc`（変更） | `main` / `assets.binding` / `run_worker_first` / `d1_databases` / `compatibility_flags` を追加 |
| `worker/index.ts`（新規） | Worker のエントリ。`/api/*` を処理し、それ以外を `ASSETS` に委ねる |
| `worker/env.ts`（新規） | `Env` 型（バインディングとシークレットの形） |
| `worker/http.ts`（新規） | JSON レスポンスとエラー応答の共通形。**全エンドポイントがここを通る** |
| `worker/http.test.ts`（新規） | 上記のテスト（node環境） |
| `d1/migrations/0001_init.sql`（新規） | `users` / `sessions` / `password_resets` テーブル |
| `package.json`（変更） | D1 マイグレーション用の npm script を追加 |

**`worker/` を `src/` の外に置く理由:** `src/` は Next のビルド対象で、`tsconfig.json` の
`paths` と `jsx` 設定が効く世界。Worker は wrangler がバンドルする別の世界であり、
混ぜると「Next のビルドに Worker のコードが引きずり込まれる」「`@/` が解決できない」
といった事故が起きる。

---

### Task 1: D1 データベースとマイグレーション

**Files:**
- Create: `d1/migrations/0001_init.sql`
- Modify: `wrangler.jsonc`
- Modify: `package.json`

**Interfaces:**
- Consumes: なし
- Produces: D1 バインディング `DB`（`worker/env.ts` が Task 2 で参照する）。テーブル `users` / `sessions` / `password_resets`

**この計画で作るのはスキーマだけ。** 読み書きするコードは A-2 で書く。
先にスキーマを確定させるのは、マイグレーションの適用が**本番に対する不可逆な操作**であり、
コードと同時に出すと切り戻しが難しくなるため。

- [ ] **Step 1: D1 データベースを作る**

```bash
npx wrangler d1 create lifeplan
```

出力される `database_id` を控える。**この値は次のステップで `wrangler.jsonc` に貼る。**

⚠️ 同名のデータベースが既にある場合はエラーになる。その場合は
`npx wrangler d1 list` で既存の `database_id` を確認して使うこと。**新しい名前を作らない**
（`lifeplan` が設計書 §9 で決まった名前）。

- [ ] **Step 2: マイグレーションを書く**

`d1/migrations/0001_init.sql`:

```sql
-- 認証の土台（docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §9）。
--
-- ここに入るのは認証・課金・利用回数だけ。
-- 年収・資産額・家族構成といった家計情報は D1 に保存しない（設計書 §5.3）。
-- localStorage に置いたままにすることで、漏洩時の被害を認証情報だけに限定する。

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  -- 正規化済み（trim + 小文字）。正規化のルールはクライアントと共有する
  email         TEXT NOT NULL UNIQUE,
  -- 形式: pbkdf2c-v<kdfVersion>$<salt_b64url>$<digest_b64url>
  -- パスワード本体もブラウザで導出した鍵も、そのままの形では保存しない
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  -- 生のトークンは保存しない。DB が漏れてもセッションを復元できないようにする
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- ログアウト時に user_id で引くため
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 期限切れの一括削除で使う
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE password_resets (
  -- セッションと同じく、生トークンは保存しない
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  -- 使用済みを記録する。NULL なら未使用。
  -- 行を消すのではなく使用済みを残すのは、「一度使ったリンクを再度踏んだ」場合に
  -- 「期限切れ」ではなく「使用済み」と正しく案内するため
  used_at    TEXT
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id);
```

- [ ] **Step 3: wrangler.jsonc に D1 バインディングを追加する**

`wrangler.jsonc` の `assets` の後ろに追加する（`main` の追加は Task 2 で行う）:

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "lifeplan",
      "database_id": "<Step 1 で控えた値をここに貼る>",
      "migrations_dir": "d1/migrations"
    }
  ],
```

- [ ] **Step 4: npm script を追加する**

`package.json` の `scripts` に追加する:

```json
    "db:migrate:local": "wrangler d1 migrations apply lifeplan --local",
    "db:migrate:remote": "wrangler d1 migrations apply lifeplan --remote"
```

- [ ] **Step 5: ローカルに適用して確認する**

```bash
npm run db:migrate:local
npx wrangler d1 execute lifeplan --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: `password_resets` / `sessions` / `users` の3つが並ぶ（`d1_migrations` も出るが問題ない）。

⚠️ **`--remote` はまだ実行しない。** 本番への適用は Task 3 の実機確認とまとめて行う。

- [ ] **Step 6: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add wrangler.jsonc package.json d1/migrations/0001_init.sql
git commit -m "feat: D1 データベースと認証テーブルのマイグレーション"
```

---

### Task 2: Worker エントリとルーティング

**Files:**
- Create: `worker/env.ts`
- Create: `worker/http.ts`
- Create: `worker/http.test.ts`
- Create: `worker/index.ts`
- Modify: `wrangler.jsonc`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: Task 1 の D1 バインディング `DB`
- Produces:
  - `Env` 型（`worker/env.ts`）— `{ ASSETS: Fetcher; DB: D1Database }`
  - `json(data, status?)` / `errorResponse(code, message, status)`（`worker/http.ts`）
  - `GET /api/health` が `{"ok":true}` を返す

- [ ] **Step 1: 失敗するテストを書く**

`worker/http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { errorResponse, json } from "./http";

describe("json", () => {
  it("既定で 200 と application/json を返す", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("ステータスを指定できる", () => {
    expect(json({ ok: true }, 201).status).toBe(201);
  });

  it("キャッシュを禁止する", () => {
    // 認証状態を含む応答が中間キャッシュに残ると、別人に配られる
    expect(json({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });
});

describe("errorResponse", () => {
  it("コードとメッセージを本文に入れる", async () => {
    const res = errorResponse("INVALID_INPUT", "入力が不正です", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "入力が不正です" },
    });
  });

  it("キャッシュを禁止する", () => {
    expect(errorResponse("X", "y", 400).headers.get("cache-control")).toBe("no-store");
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run worker/http.test.ts`
Expected: FAIL（`Failed to resolve import "./http"`）

- [ ] **Step 3: 共通のレスポンス形を実装する**

`worker/http.ts`:

```ts
/**
 * API 応答の共通形。**すべてのエンドポイントがここを通る。**
 *
 * 個々のハンドラが Response を直接組み立てると、`cache-control` の付け忘れが
 * 必ず起きる。認証状態を含む応答が中間キャッシュに残ると別人に配られるため、
 * 付け忘れが起きない場所に集約する。
 */

/** エラー応答の本文。クライアントは code で分岐し、message をそのまま表示してよい */
export interface ErrorBody {
  error: { code: string; message: string };
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  // 認証状態を含む応答をキャッシュさせない
  "cache-control": "no-store",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS } });
}

/**
 * エラー応答。
 *
 * ⚠️ message はユーザーにそのまま見せる文言だけを入れること。
 * 例外の生メッセージを入れると、設定の不備やDBの構造が外に漏れる。
 * 原因は console.error で運用ログにだけ残す。
 */
export function errorResponse(code: string, message: string, status: number): Response {
  const body: ErrorBody = { error: { code, message } };
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS } });
}
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run worker/http.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: Env 型を定義する**

`worker/env.ts`:

```ts
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
```

- [ ] **Step 6: Worker エントリを実装する**

`worker/index.ts`:

```ts
import type { Env } from "./env";
import { errorResponse, json } from "./http";

/**
 * Worker のエントリ。
 *
 * `/api/*` だけを自分で処理し、それ以外は静的アセットに委ねる。
 *
 * ⚠️ `wrangler.jsonc` の `run_worker_first: ["/api/*"]` と対になっている。
 * あちらが無いと、ナビゲーションリクエスト（アドレスバーへの直接入力・素のフォーム
 * POST・外部からのリダイレクト着地）が Worker に届かず 404.html が返る。
 * `fetch()` からの呼び出しだけは届いてしまうため、**設定を消しても
 * 普通に使っている限り気づけない。**
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // 疎通確認用。ルーティングが効いているかを本番で見るためだけに置く。
    // GET 以外を弾いておくのは、以後のエンドポイントで同じ作法を使うため
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
      }
      return json({ ok: true });
    }

    return errorResponse("NOT_FOUND", "エンドポイントが存在しません", 404);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: wrangler.jsonc を仕上げる**

`main`・`compatibility_flags`・`assets.binding`・`assets.run_worker_first` を追加する。
**Task 1 で追加した `d1_databases` は残す。**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "lifeplan-simulator",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-01",
  // stripe SDK（サブプロジェクトB）で必要になる。先に入れておく
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./out",
    // Worker から静的アセットを返すために必要
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    // ⚠️ これが無いと /api/* へのナビゲーションリクエストが 404.html になる。
    // true にすると静的アセットの配信まで Worker の実行回数に計上されるため、
    // 配列で /api/* だけに絞る
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [ /* Task 1 で追加した内容をそのまま残す */ ],
  "routes": [
    {
      "pattern": "lifeplan.nexeed-lab.com",
      "custom_domain": true
    }
  ]
}
```

- [ ] **Step 8: Cloudflare の型を有効にする**

`Fetcher` / `D1Database` / `ExportedHandler` の型は `@cloudflare/workers-types` に入っている。

```bash
npm install -D @cloudflare/workers-types
```

`tsconfig.json` の `compilerOptions.types` に追加する（`types` キーが無ければ新設する）:

```json
    "types": ["@cloudflare/workers-types"]
```

⚠️ **`types` を追加すると、それまで暗黙で読まれていた型が読まれなくなる。**
`npm run typecheck` が既存コードで落ちたら、必要なものを配列に足すこと
（例: `"types": ["@cloudflare/workers-types", "node"]`）。

- [ ] **Step 9: ローカルで疎通を確認する**

```bash
npm run build
npx wrangler dev
```

別の端末から:

```bash
curl -i http://localhost:8787/api/health
curl -i http://localhost:8787/
curl -i http://localhost:8787/api/nope
```

Expected:
- `/api/health` → `200` と `{"ok":true}`、`cache-control: no-store`
- `/` → `200` と HTML（静的アセットが返る）
- `/api/nope` → `404` と `{"error":{"code":"NOT_FOUND",...}}`（**`404.html` ではないこと**）

⚠️ **3つ目が HTML の404ページを返したら、`run_worker_first` が効いていない。**
先に進まずに `wrangler.jsonc` を見直すこと。

- [ ] **Step 10: 全体を確認してコミットする**

```bash
npm test && npm run typecheck && npm run lint
git add worker/ wrangler.jsonc tsconfig.json package.json package-lock.json
git commit -m "feat: /api/* を処理する Worker とルーティング設定"
```

---

### Task 3: 本番での routing 検証

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md`（検証結果の追記）

**Interfaces:**
- Consumes: Task 2 の `/api/health`
- Produces: なし（検証と記録）

**このタスクは実機確認が目的。** ローカルの `wrangler dev` と本番では
アセットのルーティング挙動が異なりうるため、**必ず本番で確かめる。**
このプロジェクトでは、テスト・型チェック・lint・コードレビューをすべて通過した
recharts の軸設定が本番で初めて壊れていた事例がある。

- [ ] **Step 1: 本番の D1 にマイグレーションを適用する**

```bash
npm run db:migrate:remote
```

⚠️ **これは本番に対する不可逆な操作。** 実行前に `d1/migrations/0001_init.sql` を
もう一度読み、テーブル名・カラム名が設計書 §9 と一致していることを確認する。

- [ ] **Step 2: デプロイする**

```bash
npm run deploy
```

- [ ] **Step 3: `fetch()` 経路を確認する**

```bash
curl -i https://lifeplan.nexeed-lab.com/api/health
```

Expected: `200` / `{"ok":true}` / `cache-control: no-store`

- [ ] **Step 4: ナビゲーション経路を確認する（このタスクの本題）**

**ブラウザのアドレスバーに直接** `https://lifeplan.nexeed-lab.com/api/health` を入力して開く。

Expected: `{"ok":true}` が表示される。

⚠️ **404ページが出たら `run_worker_first` が効いていない。**
`curl` は通るのにブラウザで開くと404になる、というのがまさに今回塞ごうとしている罠。
**片方だけの確認では意味がない。**

- [ ] **Step 5: 既存ページが壊れていないことを確認する**

```bash
curl -o /dev/null -s -w "top:%{http_code}\n" https://lifeplan.nexeed-lab.com/
curl -o /dev/null -s -w "privacy:%{http_code}\n" https://lifeplan.nexeed-lab.com/privacy
curl -o /dev/null -s -w "404:%{http_code}\n" https://lifeplan.nexeed-lab.com/nope
```

Expected: `top:200` / `privacy:200` / `404:404`

さらにブラウザでトップページを開き、**シミュレーターが従来どおり動くこと**
（モーダルが開く・プルダウンが選べる・グラフが描画される）を目視する。
Worker を通すようになったことで静的アセットの配信が壊れていないかの確認。

- [ ] **Step 6: 検証結果を設計書に記録する**

`docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` の §10.1 の末尾に追記する:

```markdown
**検証結果（2026-08-12）:** `run_worker_first: ["/api/*"]` を設定した状態で、
`curl` とブラウザのアドレスバー直接入力の**両方**で `/api/health` が
Worker に到達することを本番で確認した。
```

- [ ] **Step 7: コミットする**

```bash
git add docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md
git commit -m "docs: 本番でのルーティング検証結果を記録"
```

---

## Self-Review

**1. 仕様カバレッジ（設計書 §9・§10 との突き合わせ）**

| 設計書 | 対応するタスク |
|---|---|
| §9 D1 `lifeplan` を新規作成（`nexeed-lab-db` を使わない） | Task 1 Step 1 |
| §9 `users` / `sessions` テーブル | Task 1 Step 2 |
| §10 `main` と `assets.binding` の追加 | Task 2 Step 7 |
| §10.1 `run_worker_first: ["/api/*"]` | Task 2 Step 7・Task 3 Step 4 |
| §10 OpenNext を使わない（静的エクスポート＋Worker 1本） | 全タスク（`next.config.ts` を触らない） |

`subscriptions` と `usage_monthly` テーブルは**この計画に含めない。**
サブプロジェクトB（Stripe）で必要になるまで作らない（YAGNI）。
`password_resets` を先に作るのは、A-3 のパスワード再設定で使うため。

**2. プレースホルダ走査**

`<Step 1 で控えた値をここに貼る>` は、実行しないと決まらない値なので意図的に残している。
それ以外に「TBD」「適切に」「同様に」は無し。

**3. 型の整合**

- `Env`（`ASSETS: Fetcher` / `DB: D1Database`）は Task 2 Step 5 の定義と
  Step 6 の使用箇所（`env.ASSETS.fetch`）で一致
- `json(data, status?)` / `errorResponse(code, message, status)` は
  Task 2 Step 3 の定義と Step 6 の呼び出しで一致
- D1 バインディング名 `DB` は Task 1 Step 3 の `wrangler.jsonc` と
  Task 2 Step 5 の `Env` で一致

**4. 既存への影響**

- `src/` 以下は1ファイルも変更しない
- `tsconfig.json` の `types` 追加は既存コードの型解決に影響しうる（Task 2 Step 8 に注意書きあり）
- `wrangler.jsonc` に `main` が入ることで、**全リクエストの経路が変わる**。
  これが Task 3 Step 5 で既存ページを確認する理由
