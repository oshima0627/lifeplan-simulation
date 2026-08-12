# サブプロジェクトA-2：認証コア 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登録・ログイン・ログアウト・ログイン状態の取得ができる認証APIを作る。**パスワード本体はサーバーに送らない。**

**Architecture:** ブラウザで PBKDF2 を60万回回して256bitの鍵を導出し、サーバーへ送るのはその鍵だけ。サーバーはソルト付きで SHA-256 を1回かけて D1 に保存する。セッションは32バイトの乱数を Cookie に入れ、D1 にはハッシュだけを保存する。

**Tech Stack:** Cloudflare Workers / D1 / Web Crypto / TypeScript / Vitest 4

## Global Constraints

- 設計の正は `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` **§5**。数値はそこから逐語で引く
- **UI（ログイン画面など）は作らない。** このサブプロジェクトの完了確認は `curl` によるAPI疎通まで。画面は A-4
- **メール送信は使わない。** パスワード再設定は A-3
- **Turnstile もレート制限もこの計画には含めない。** A-3
- Worker のコードから `@/` エイリアスを使わない（`worker/tsconfig.json` の `"paths": {}` が型検査で強制している）
- **`src/lib/lifeplan/` と `src/components/` を変更しない。** 既存の試算機能に影響を出さない
- 既存テスト243件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **`git add` は変更したファイルを明示的に列挙する。`git add -A` は使わない**
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる
- **push とデプロイはしない。** 制御側が行う

### Cloudflare 公式のベストプラクティス（設計書 §5.3.1）

| 必ず守ること | 理由 |
|---|---|
| **`Env` を手書きしない。`wrangler types` で生成する** | 手書きは `wrangler.jsonc` の実際のバインディングと乖離する |
| **`crypto.subtle.timingSafeEqual` を使う**（手書きの定数時間比較を書かない） | Workers に組み込みがある。⚠️ **長さが違うと例外を投げる**ので先に長さを比較する |
| トークン生成は `crypto.getRandomValues()` | `Math.random()` は予測可能 |
| 浮いた Promise を作らない | すべて `await` / `return` / `void` |
| `ctx` を分割代入しない | `this` が外れて実行時エラーになる |
| `as unknown as T` の二重キャストを書かない | 型の不整合を隠す。設計で解く |

### 移植元（`projects/pre-meet`）

**ゼロから書かない。** ただし pre-meet は Next.js のサーバーコード（`next/headers` の `cookies()`、`NextResponse`、`runtime = "nodejs"`）を使っており、**HTTP層はそのまま使えない。**

| 移植元 | 扱い |
|---|---|
| `apps/web/lib/password-kdf.ts` | **ロジックをほぼそのまま移植**（Web Crypto のみで Next 非依存） |
| `apps/web/lib/password.ts` | 移植。ただし**手書きの `timingSafeEqual` は `crypto.subtle.timingSafeEqual` に置き換える** |
| `apps/web/lib/auth.ts` | セッションの考え方だけ流用。`next/headers` 依存の部分は書き直す |
| `apps/web/app/api/auth/*` | **書き直す。** 素の `Request`/`Response` で組む |

⚠️ **ソルトの文字列を pre-meet からコピーしない。** pre-meet は `premeet-kdf-v${version}:${email}`。
本プロジェクトは **`lifeplan-kdf-v${version}:${email}`** にする。同じにすると、
両サービスで同じパスワードを使っているユーザーの鍵が一致してしまう。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `shared/auth/email.ts`（新規） | メールの正規化。**ブラウザとWorkerの両方が使う唯一の共有コード** |
| `shared/auth/email.test.ts`（新規） | 上記のテスト（node） |
| `src/lib/auth/kdf.ts`（新規） | ブラウザ側の鍵導出（PBKDF2 60万回） |
| `src/lib/auth/kdf.test.ts`（新規） | 上記のテスト（node。Web Crypto は Node にもある） |
| `worker/auth/password.ts`（新規） | サーバー側のハッシュ保存・照合 |
| `worker/auth/password.test.ts`（新規） | 上記のテスト |
| `worker/cookies.ts`（新規） | `Set-Cookie` の組み立てと `Cookie` の解析 |
| `worker/cookies.test.ts`（新規） | 上記のテスト |
| `worker/auth/session.ts`（新規） | トークン生成・ハッシュ・有効期限 |
| `worker/auth/session.test.ts`（新規） | 上記のテスト |
| `worker/db.ts`（新規） | D1 へのアクセス。**SQL をルートに散らさない** |
| `worker/auth/routes.ts`（新規） | signup / login / logout / me のハンドラ |
| `worker/index.ts`（変更） | 上記を配線 |
| `worker/env.ts`（**削除**） | `wrangler types` の生成物に置き換える |
| `wrangler.jsonc`（変更） | `observability` と `vars.MAIL_FROM` を追加 |
| `tsconfig.json` / `worker/tsconfig.json`（変更） | `shared/` を両方の検査対象に入れる |

**なぜ共有を `shared/auth/email.ts` だけに絞るか:**
PBKDF2 の導出はブラウザ専用、ハッシュ照合はWorker専用で、**両方が必要とするのは
メール正規化だけ**。`worker/` は `@/` を使えず tsconfig も分かれているため、
共有面が広いほど設定が複雑になる。正規化だけは共有が必須で、
**ズレるとソルトが変わり、正しいパスワードでログインできなくなる。**

---

### Task 1: 共有のメール正規化

**Files:**
- Create: `shared/auth/email.ts`, `shared/auth/email.test.ts`
- Modify: `tsconfig.json`, `worker/tsconfig.json`, `vitest.config.mts`

**Interfaces:**
- Produces: `normalizeEmail(raw: unknown): string | null`

- [ ] **Step 1: 失敗するテストを書く**

`shared/auth/email.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("小文字にして前後の空白を落とす", () => {
    expect(normalizeEmail("  Foo@Example.COM  ")).toBe("foo@example.com");
  });

  it("文字列でなければ null", () => {
    expect(normalizeEmail(123)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("形式が不正なら null", () => {
    expect(normalizeEmail("foo")).toBeNull();
    expect(normalizeEmail("foo@")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("foo@example")).toBeNull();
    expect(normalizeEmail("a b@example.com")).toBeNull();
  });

  it("254文字を超えるものは null", () => {
    const long = `${"a".repeat(250)}@example.com`;
    expect(normalizeEmail(long)).toBeNull();
  });

  it("同じアドレスの大文字小文字違いが同じ結果になる（アカウント二重作成を防ぐ要）", () => {
    expect(normalizeEmail("A@X.com")).toBe(normalizeEmail("a@x.com"));
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run shared/auth/email.test.ts`
Expected: FAIL（テストファイルが見つからない、またはモジュール未解決）

`No test files found` になる場合は `vitest.config.mts` の `include` に
`"shared/**/*.test.{ts,tsx}"` を追加してから再実行する。

- [ ] **Step 3: 実装する**

`shared/auth/email.ts`:

```ts
/**
 * メールアドレスの正規化。
 *
 * ⚠️ **ブラウザとサーバーで必ず同じ結果になること。**
 * ブラウザ側の鍵導出はこの正規化結果からソルトを作る（src/lib/auth/kdf.ts）。
 * ズレるとソルトが変わり、**正しいパスワードでもログインできなくなる。**
 * だからこの関数だけを shared/ に置き、両方から同じ実体を import する。
 *
 * サーバー側でも必ず再正規化すること。クライアントの正規化を信用して
 * そのまま保存すると、`A@x.com` と `a@x.com` で2アカウント作れてしまい、
 * users.email の UNIQUE 制約も「お試しは月1回」の数え方も無意味になる。
 *
 * 厳密な RFC 準拠は狙わない。最終的な到達性はメールが届くかどうかで決まる。
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
```

- [ ] **Step 4: 両方の tsconfig から見えるようにする**

`tsconfig.json` の `include` に `shared` が含まれることを確認する（既定で
プロジェクト全体が対象なら不要）。`exclude` に `shared` が**入っていない**ことを確認する。

`worker/tsconfig.json` の `include` を変更する:

```json
  "include": ["**/*.ts", "../shared/**/*.ts"],
```

⚠️ **`worker/tsconfig.json` は `"paths": {}` を持つので、`shared/` からの import は
相対パス（`../../shared/auth/email`）になる。** これは意図した制約。

- [ ] **Step 5: 両方の型検査で見えていることを確認する**

```bash
npm run typecheck
```

さらに、**実際に検査対象に入っているか**を確かめる:

```bash
npx tsc --noEmit -p worker/tsconfig.json --listFiles | grep "shared/auth/email"
```

Expected: パスが1行出る。**出なければ include が効いていない。**

- [ ] **Step 6: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add shared/ tsconfig.json worker/tsconfig.json vitest.config.mts
git commit -m "feat: ブラウザとWorkerで共有するメール正規化"
```

---

### Task 2: ブラウザ側の鍵導出

**Files:**
- Create: `src/lib/auth/kdf.ts`, `src/lib/auth/kdf.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail` from `@/../shared/auth/email`（`src/` 側は `@/` が使えるが、
  `shared/` は `src/` の外なので**相対パス** `../../../shared/auth/email` を使う）
- Produces:
  - `KDF_VERSION: number`（= 1）
  - `PASSWORD_MIN_LENGTH: number`（= 8）、`PASSWORD_MAX_LENGTH: number`（= 200）
  - `deriveClientKey(email: string, password: string): Promise<string>`
  - `isValidClientKey(raw: unknown): raw is string`
  - `isKnownKdfVersion(raw: unknown): raw is number`
  - `toBase64Url(bytes: Uint8Array): string` / `fromBase64Url(value: string): Uint8Array`

**なぜブラウザで回すか:** PBKDF2 は「わざと重くする」処理で、Workers の CPU 10ms/リクエストには
原理的に収まらない。サーバーで回数を削るとストレッチングの意味が消えるため、計算を利用者の端末に移す。
サーバーは受け取った鍵を1回ハッシュするだけ（1ms未満）で済む。
**この構成で防御力は落ちない。** DB が漏れても、攻撃者はパスワード候補1つごとに
下記の反復回数を自分で回す必要がある。

**代償:** JavaScript が必須になり、サーバー側でパスワードの長さを検証できない
（長さのチェックはブラウザ側の助言に留まる）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/auth/kdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveClientKey,
  fromBase64Url,
  isKnownKdfVersion,
  isValidClientKey,
  KDF_VERSION,
  toBase64Url,
} from "./kdf";

describe("base64url", () => {
  it("往復して元に戻る", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it("URLで問題になる文字を含まない", () => {
    const bytes = new Uint8Array([251, 255, 190]);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
});

describe("deriveClientKey", () => {
  it("同じメール・同じパスワードなら同じ鍵になる", async () => {
    const a = await deriveClientKey("foo@example.com", "correct horse battery");
    const b = await deriveClientKey("foo@example.com", "correct horse battery");
    expect(a).toBe(b);
  });

  it("メールの大文字小文字が違っても同じ鍵になる（正規化が効いている）", async () => {
    const a = await deriveClientKey("Foo@Example.COM", "correct horse battery");
    const b = await deriveClientKey("foo@example.com", "correct horse battery");
    expect(a).toBe(b);
  });

  it("パスワードが違えば違う鍵になる", async () => {
    const a = await deriveClientKey("foo@example.com", "aaaaaaaa");
    const b = await deriveClientKey("foo@example.com", "bbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("メールが違えば違う鍵になる（ソルトがメール由来）", async () => {
    const a = await deriveClientKey("foo@example.com", "aaaaaaaa");
    const b = await deriveClientKey("bar@example.com", "aaaaaaaa");
    expect(a).not.toBe(b);
  });

  it("形式が不正なメールでは例外を投げる", async () => {
    await expect(deriveClientKey("not-an-email", "aaaaaaaa")).rejects.toThrow();
  });

  it("鍵は256bitを base64url にした43文字", async () => {
    const key = await deriveClientKey("foo@example.com", "aaaaaaaa");
    expect(key).toHaveLength(43);
    expect(isValidClientKey(key)).toBe(true);
  });
}, 60_000);

describe("isValidClientKey", () => {
  it("43文字の base64url だけを受け付ける", () => {
    expect(isValidClientKey("a".repeat(43))).toBe(true);
    expect(isValidClientKey("a".repeat(42))).toBe(false);
    expect(isValidClientKey("a".repeat(44))).toBe(false);
    expect(isValidClientKey(`${"a".repeat(42)}+`)).toBe(false);
    expect(isValidClientKey(123)).toBe(false);
  });
});

describe("isKnownKdfVersion", () => {
  it("既知の版だけを受け付ける", () => {
    expect(isKnownKdfVersion(KDF_VERSION)).toBe(true);
    expect(isKnownKdfVersion(999)).toBe(false);
    expect(isKnownKdfVersion("1")).toBe(false);
  });
});
```

⚠️ **PBKDF2 60万回を複数回まわすのでテストは遅い。** `describe` に
タイムアウト 60 秒を指定してある。これを削らないこと。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/auth/kdf.test.ts`
Expected: FAIL（`Failed to resolve import "./kdf"`）

- [ ] **Step 3: 実装する**

`src/lib/auth/kdf.ts` を作る。**`projects/pre-meet/apps/web/lib/password-kdf.ts` を
読んで、そのロジックを移植すること。** 以下の点だけ変える。

| 変更点 | 内容 |
|---|---|
| ソルトの文字列 | `premeet-kdf-v${version}:${email}` → **`lifeplan-kdf-v${version}:${email}`** |
| `normalizeEmail` | 自前で持たず `shared/auth/email.ts` から import する（相対パス） |

**変えないもの:** 反復回数 600,000、鍵長 256bit、`KDF_VERSION = 1`、
`PASSWORD_MIN_LENGTH = 8` / `PASSWORD_MAX_LENGTH = 200`、
`KEY_BASE64URL_LENGTH = 43`、`toBase64Url` / `fromBase64Url` の実装。

`KDF_VERSION` を版として持つのは、後でブラウザ側の反復回数を上げたときに
「この人はまだ旧版」を判別して移行させるため。

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/lib/auth/kdf.test.ts`
Expected: PASS（12件）

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/auth/
git commit -m "feat: ブラウザ側の鍵導出（PBKDF2 60万回）"
```

---

### Task 3: サーバー側のパスワード保存・照合

**Files:**
- Create: `worker/auth/password.ts`, `worker/auth/password.test.ts`

**Interfaces:**
- Produces:
  - `hashClientKey(clientKey: string, kdfVersion: number): Promise<string>`
  - `verifyClientKey(clientKey: string, stored: string): Promise<boolean>`
  - `storedKdfVersion(stored: string): number | null`
  - `readClientKeyInput(body: { kdfVersion?: unknown; key?: unknown }): { key: string; kdfVersion: number } | null`

保存形式: `pbkdf2c-v<kdfVersion>$<serverSalt_b64url>$<digest_b64url>`

**サーバー側が SHA-256 の1回で足りる理由:** 受け取る値は 256bit の高エントロピー鍵であり、
辞書攻撃もレインボーテーブルも成立しない。攻撃者が DB を盗んでも、パスワード候補を
1つ試すたびにブラウザ側の60万回を自分で回す必要がある。
**CPU コストはマイクロ秒オーダーなので Workers の 10ms 制限に収まる。**

- [ ] **Step 1: 失敗するテストを書く**

`worker/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  hashClientKey,
  readClientKeyInput,
  storedKdfVersion,
  verifyClientKey,
} from "./password";

const KEY = "a".repeat(43);
const OTHER = "b".repeat(43);

describe("hashClientKey / verifyClientKey", () => {
  it("保存形式が pbkdf2c-v<版>$<ソルト>$<ダイジェスト>", async () => {
    const stored = await hashClientKey(KEY, 1);
    expect(stored).toMatch(/^pbkdf2c-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("同じ鍵でも毎回違うハッシュになる（ソルトが乱数）", async () => {
    expect(await hashClientKey(KEY, 1)).not.toBe(await hashClientKey(KEY, 1));
  });

  it("正しい鍵なら検証が通る", async () => {
    expect(await verifyClientKey(KEY, await hashClientKey(KEY, 1))).toBe(true);
  });

  it("違う鍵なら検証が落ちる", async () => {
    expect(await verifyClientKey(OTHER, await hashClientKey(KEY, 1))).toBe(false);
  });

  it("壊れた保存値では常に false（例外を投げない）", async () => {
    expect(await verifyClientKey(KEY, "")).toBe(false);
    expect(await verifyClientKey(KEY, "garbage")).toBe(false);
    expect(await verifyClientKey(KEY, "pbkdf2c-v1$only-two-parts")).toBe(false);
    expect(await verifyClientKey(KEY, "notascheme-v1$aaa$bbb")).toBe(false);
  });
});

describe("storedKdfVersion", () => {
  it("保存値から版を読める", async () => {
    expect(storedKdfVersion(await hashClientKey(KEY, 1))).toBe(1);
  });

  it("壊れた保存値では null", () => {
    expect(storedKdfVersion("garbage")).toBeNull();
  });
});

describe("readClientKeyInput", () => {
  it("正しい形なら受け付ける", () => {
    expect(readClientKeyInput({ key: KEY, kdfVersion: 1 })).toEqual({
      key: KEY,
      kdfVersion: 1,
    });
  });

  it("鍵の形が不正なら null", () => {
    expect(readClientKeyInput({ key: "short", kdfVersion: 1 })).toBeNull();
    expect(readClientKeyInput({ key: 123, kdfVersion: 1 })).toBeNull();
  });

  it("未知の版なら null", () => {
    expect(readClientKeyInput({ key: KEY, kdfVersion: 999 })).toBeNull();
    expect(readClientKeyInput({ key: KEY, kdfVersion: "1" })).toBeNull();
  });

  it("欠けていれば null", () => {
    expect(readClientKeyInput({})).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run worker/auth/password.test.ts`
Expected: FAIL（`Failed to resolve import "./password"`）

- [ ] **Step 3: 実装する**

`projects/pre-meet/apps/web/lib/password.ts` を読んで移植する。**以下の1点だけ変える。**

⚠️ **手書きの `timingSafeEqual` を書かないこと。** Cloudflare Workers には
`crypto.subtle.timingSafeEqual(a, b): boolean` の組み込みがある
（`node_modules/@cloudflare/workers-types/index.d.ts` に定義を確認済み）。

**ただし長さが違うと例外を投げる。** 必ずこの形にする:

```ts
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // 長さが違うと crypto.subtle.timingSafeEqual は例外を投げる。
  // 長さ自体は秘密ではない（ダイジェストは常に32バイト）ので、先に比較して弾く
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
```

`readClientKeyInput` は `src/lib/auth/kdf.ts` の `isValidClientKey` /
`isKnownKdfVersion` と**同じ判定**をする必要があるが、
**`worker/` から `src/` を import しない**（`"paths": {}` で封じてある）。
`worker/auth/password.ts` の中に同等の判定を書くこと。判定は
「43文字の base64url」「既知の版番号」の2つだけなので重複の害は小さい。

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run worker/auth/password.test.ts`
Expected: PASS（12件）

**`crypto.subtle.timingSafeEqual` が Node のテスト環境に無くて落ちる場合は、
そこで止まって報告すること。** 勝手に手書きの比較へ戻さない
（実行環境は Workers なので、テスト環境の都合で本番の実装を弱めるのは本末転倒）。
対処の選択肢は制御側が判断する。

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add worker/auth/
git commit -m "feat: サーバー側のパスワード保存と定数時間照合"
```

---

### Task 4: セッションと Cookie

**Files:**
- Create: `worker/cookies.ts`, `worker/cookies.test.ts`
- Create: `worker/auth/session.ts`, `worker/auth/session.test.ts`

**Interfaces:**
- Produces（`worker/cookies.ts`）:
  - `SESSION_COOKIE: string`（= `"lp_session"`）
  - `buildSetCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string`
  - `readCookie(request: Request, name: string): string | null`
- Produces（`worker/auth/session.ts`）:
  - `SESSION_TTL_DAYS: number`（= 30）
  - `newSessionToken(): string`
  - `hashToken(token: string): Promise<string>`
  - `sessionExpiryIso(from?: Date): string`

- [ ] **Step 1: 失敗するテストを書く**

`worker/cookies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSetCookie, readCookie, SESSION_COOKIE } from "./cookies";

describe("buildSetCookie", () => {
  it("httpOnly と SameSite=Lax と Path=/ を必ず付ける", () => {
    const v = buildSetCookie(SESSION_COOKIE, "abc", 100, true);
    expect(v).toContain("HttpOnly");
    expect(v).toContain("SameSite=Lax");
    expect(v).toContain("Path=/");
  });

  it("secure が true なら Secure を付ける", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 100, true)).toContain("Secure");
  });

  it("secure が false なら Secure を付けない（ローカル開発用）", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 100, false)).not.toContain("Secure");
  });

  it("Max-Age を秒で入れる", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 2592000, true)).toContain("Max-Age=2592000");
  });

  it("値をURLエンコードする", () => {
    expect(buildSetCookie("n", "a b;c", 1, true)).toContain(`n=${encodeURIComponent("a b;c")}`);
  });
});

describe("readCookie", () => {
  function req(cookie?: string): Request {
    return new Request("https://example.com/", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("目的の Cookie を取り出す", () => {
    expect(readCookie(req("a=1; lp_session=xyz; b=2"), "lp_session")).toBe("xyz");
  });

  it("URLエンコードを戻す", () => {
    expect(readCookie(req(`lp_session=${encodeURIComponent("a b")}`), "lp_session")).toBe("a b");
  });

  it("無ければ null", () => {
    expect(readCookie(req("a=1"), "lp_session")).toBeNull();
    expect(readCookie(req(), "lp_session")).toBeNull();
  });

  it("名前の前方一致で誤検出しない", () => {
    expect(readCookie(req("lp_session_x=wrong"), "lp_session")).toBeNull();
  });
});
```

`worker/auth/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashToken, newSessionToken, sessionExpiryIso, SESSION_TTL_DAYS } from "./session";

describe("newSessionToken", () => {
  it("毎回違う値になる", () => {
    expect(newSessionToken()).not.toBe(newSessionToken());
  });

  it("base64url で十分な長さがある（32バイト＝43文字）", () => {
    const t = newSessionToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("同じ入力なら同じハッシュ", async () => {
    expect(await hashToken("abc")).toBe(await hashToken("abc"));
  });

  it("違う入力なら違うハッシュ", async () => {
    expect(await hashToken("abc")).not.toBe(await hashToken("abd"));
  });

  it("SHA-256 の16進64文字", async () => {
    expect(await hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("生のトークンを含まない（DBが漏れても復元できないこと）", async () => {
    const token = newSessionToken();
    expect(await hashToken(token)).not.toContain(token);
  });
});

describe("sessionExpiryIso", () => {
  it("基準から30日後のISO文字列", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExpiryIso(from)).toBe("2026-01-31T00:00:00.000Z");
    expect(SESSION_TTL_DAYS).toBe(30);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run worker/cookies.test.ts worker/auth/session.test.ts`
Expected: FAIL（モジュール未解決）

- [ ] **Step 3: 実装する**

`worker/cookies.ts` を書く。`next/headers` は使えないので**素の文字列で組む。**

```ts
/** セッションCookieの名前。pre-meet の pm_session と衝突させない */
export const SESSION_COOKIE = "lp_session";

/**
 * Set-Cookie の値を組み立てる。
 *
 * - `HttpOnly` … JavaScript から読めなくする（XSS でトークンを盗まれない）
 * - `SameSite=Lax` … 他サイトからのPOSTにCookieを載せない（CSRF対策）
 * - `Path=/` … サイト全体で使う
 * - `Secure` … https のときだけ付ける。ローカル開発（http）では付けない
 */
export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** リクエストの Cookie ヘッダから1つ取り出す */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
```

`worker/auth/session.ts` を書く。**トークンは `crypto.getRandomValues` で作る**
（`Math.random()` は予測可能なので使わない）。**D1 に保存するのはハッシュだけ。**

`hashToken` は SHA-256 の16進文字列を返す。`newSessionToken` は32バイトの乱数を
base64url にする（`src/lib/auth/kdf.ts` の `toBase64Url` と同じ変換だが、
`worker/` から `src/` を import できないので同等の実装を置く）。

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run worker/cookies.test.ts worker/auth/session.test.ts`
Expected: PASS（13件）

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add worker/cookies.ts worker/cookies.test.ts worker/auth/session.ts worker/auth/session.test.ts
git commit -m "feat: セッショントークンとCookieの組み立て"
```

---

### Task 5: D1 アクセス層

**Files:**
- Create: `worker/db.ts`

**Interfaces:**
- Produces:
  - `createUser(db: D1Database, input: { id: string; email: string; passwordHash: string }): Promise<boolean>` — メール重複なら `false`
  - `findUserByEmail(db: D1Database, email: string): Promise<{ id: string; passwordHash: string } | null>`
  - `createSession(db: D1Database, input: { tokenHash: string; userId: string; expiresAt: string }): Promise<void>`
  - `findUserIdBySession(db: D1Database, tokenHash: string): Promise<string | null>` — 期限切れは `null`
  - `deleteSession(db: D1Database, tokenHash: string): Promise<void>`

**SQL をルートに散らさない。** 原子性と冪等性をどこで担保しているかを追えなくなるため、
D1 への問い合わせはこのファイルに集約する。

- [ ] **Step 1: 実装する**

`worker/db.ts` を書く。すべて `db.prepare(...).bind(...)` を使い、
**文字列連結で SQL を組まない**（SQLインジェクション）。

`createUser` は `users.email` の UNIQUE 制約違反を捕まえて `false` を返す。
**「このメールは登録済みです」を呼び出し側が返さないこと**（登録済みアドレスの
洗い出しに使われる）。呼び出し側の文言は Task 6 で指定する。

`findUserIdBySession` は `expires_at > ?`（現在時刻のISO文字列）を条件に入れ、
**期限切れのセッションを返さない。**

- [ ] **Step 2: 型検査を通す**

```bash
npm run typecheck
```

⚠️ **このタスクにユニットテストは書かない。** D1 のモックを書くと、
検証しているのが「モックの振る舞い」になり実質的な担保にならない。
**実際の疎通は Task 6 の後に `wrangler dev`（ローカルD1）で確認する。**

- [ ] **Step 3: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add worker/db.ts
git commit -m "feat: 認証まわりのD1アクセス層"
```

---

### Task 6: ルート配線と Env の生成化

**Files:**
- Create: `worker/auth/routes.ts`
- Modify: `worker/index.ts`
- Delete: `worker/env.ts`
- Modify: `wrangler.jsonc`, `package.json`, `worker/tsconfig.json`

**Interfaces:**
- Consumes: Task 1〜5 のすべて
- Produces: `POST /api/auth/signup` / `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`

- [ ] **Step 1: `wrangler.jsonc` に observability と MAIL_FROM を足す**

```jsonc
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "vars": {
    // 公開値なのでシークレットにしない。RESEND_API_KEY は絶対にここへ置かない
    "MAIL_FROM": "ライフプランシミュレーター <noreply@nexeed-lab.com>"
  },
```

- [ ] **Step 2: `Env` を `wrangler types` の生成物に切り替える**

```bash
npx wrangler types --env-interface Env worker/worker-configuration.d.ts
```

生成された内容を確認し、`ASSETS` / `DB` / `MAIL_FROM` / `RESEND_API_KEY` が
含まれているかを見る。**`RESEND_API_KEY` はシークレットなので生成物に出ないことがある。**
出ない場合は、生成ファイルを直接編集せず、`worker/env.ts` を作り直して

```ts
export interface AppEnv extends Env {
  RESEND_API_KEY: string;
}
```

のように**拡張する形**にする（生成物は再生成で上書きされるため）。

`worker/tsconfig.json` の `include` に生成ファイルが入ることを確認する。

**手書きの `worker/env.ts` は削除する**（Cloudflare 公式が「手書きは実際の
バインディングと乖離する」として禁じている）。

`package.json` に生成コマンドを足しておく:

```json
    "cf:typegen": "wrangler types --env-interface Env worker/worker-configuration.d.ts"
```

- [ ] **Step 3: ルートを実装する**

`worker/auth/routes.ts` に4つのハンドラを書く。**すべて `worker/http.ts` の
`json` / `errorResponse` を通す。**

| ルート | 動作 |
|---|---|
| `POST /api/auth/signup` | メールを**サーバー側で再正規化**し、鍵の形を検証し、ハッシュして `users` に入れ、セッションを張って `Set-Cookie` を返す |
| `POST /api/auth/login` | メールで引き、`verifyClientKey` で照合し、通ればセッションを張る |
| `POST /api/auth/logout` | Cookie のトークンをハッシュしてセッション行を消し、`Max-Age=0` の Cookie を返す |
| `GET /api/auth/me` | Cookie からセッションを引き、`{ userId }` か `{ userId: null }` を返す |

**必ず守ること:**

1. **メールは必ずサーバー側で `normalizeEmail` にかける。** クライアントの正規化を信用しない
2. **`login` の失敗は「メールアドレスまたはパスワードが違います」の一本にし、
   ユーザーが存在しない場合と鍵が違う場合で文言もステータスも変えない。**
   （既存アカウントを守る側なので、この2ケースの統一だけは崩さない）
   `signup` のメール重複は別扱いにしてよい。専用の応答（例: 409 /
   `EMAIL_TAKEN`）にすることで「登録済みの人が signup 画面で
   `login` すべきと気づけない」事故を避ける。これは列挙（そのアドレスが
   登録済みかを試せる窓口）を許容するトレードオフであり、**A-3 の
   Turnstile とレート制限を導入するまで本番公開しないこと**が前提になる
   （spec §5.4.1 に決定として記録済み）
3. **`logout` は DB の削除に失敗しても Cookie は必ず落とす。** ログアウトを失敗させない
4. **`Secure` 属性はリクエストの**ホスト名**で判定する（スキームで判定しない）。**
   Workers には `http://` のリクエストもそのまま届くため、
   `new URL(request.url).protocol === "https:"` のようにスキームで判定すると、
   利用者が http で本番ドメインに着地したままログインしたときに `Secure` 無しの
   Cookie が発行され、以降トークンが平文で流れる。
   `localhost` / `127.0.0.1` / `[::1]` のときだけ外し、それ以外は常に付ける
5. ユーザーIDは `crypto.randomUUID()` で作る

- [ ] **Step 4: `worker/index.ts` に配線する**

`/api/health` の分岐の後ろに `/api/auth/*` の分岐を足す。**メソッド判定を各分岐の
内側に書くと 405 の処理がエンドポイント数だけ重複する**ので、
`` `${request.method} ${url.pathname}` `` をキーにしたテーブルへ寄せてよい。

寄せる場合、**未知メソッド→405・未知パス→404 が1箇所で決まる形**にすること。

- [ ] **Step 5: ローカルで疎通を確認する**

```bash
npm run db:migrate:local
npm run build
npx wrangler dev
```

別の端末から、**登録→ログイン状態確認→ログアウト→再ログイン**を通しで実行する。
鍵は43文字の base64url なら何でもよい（サーバーは形しか見ない）。

```bash
# 登録
curl -i -c /tmp/lp.jar -X POST http://localhost:8787/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kdfVersion":1}'

# ログイン状態
curl -s -b /tmp/lp.jar http://localhost:8787/api/auth/me

# 同じメールで再登録（存在を明かさない文言が返ること）
curl -s -X POST http://localhost:8787/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kdfVersion":1}'

# 間違った鍵でログイン
curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kdfVersion":1}'

# 存在しないメールでログイン（上と同じ文言・同じステータスであること）
curl -s -X POST http://localhost:8787/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com","key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kdfVersion":1}'

# ログアウト
curl -i -b /tmp/lp.jar -c /tmp/lp.jar -X POST http://localhost:8787/api/auth/logout

# ログアウト後
curl -s -b /tmp/lp.jar http://localhost:8787/api/auth/me
```

**確認すること:**

- 登録で `Set-Cookie: lp_session=...` に `HttpOnly` `SameSite=Lax` `Path=/` が付く
- `me` が登録直後は `userId` を返し、ログアウト後は `null` を返す
- **重複登録・鍵違い・存在しないメールの3つが、存在を推測できない応答になっている**
- 全応答に `cache-control: no-store` が付く

**実際の curl 出力を報告書に貼ること。**

- [ ] **Step 6: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add worker/ wrangler.jsonc package.json
git rm worker/env.ts   # 生成物に置き換えた場合
git commit -m "feat: 認証API（登録・ログイン・ログアウト・状態取得）"
```

---

## Self-Review

**1. 仕様カバレッジ（設計書 §5 との突き合わせ）**

| 設計書 | 対応するタスク |
|---|---|
| §5.1 ブラウザで PBKDF2 60万回・鍵だけ送る | Task 2 |
| §5.1 サーバーはソルト付き SHA-256 を1回 | Task 3 |
| §5.1 保存形式 `pbkdf2c-v<n>$<salt>$<digest>` | Task 3 |
| §5.2 32バイト乱数の Cookie・httpOnly/secure/SameSite=Lax | Task 4 |
| §5.2 D1 にはハッシュだけ・有効期間30日 | Task 4・Task 5 |
| §5.3 ヒアリングシートをサーバーに保存しない | 全タスク（`HearingSheet` に触れない） |
| §5.3.1 `wrangler types` で `Env` を生成 | Task 6 Step 2 |
| §5.3.1 `crypto.subtle.timingSafeEqual` | Task 3 Step 3 |
| §5.3.1 `observability` を有効化 | Task 6 Step 1 |
| §5.3.2 `MAIL_FROM` を `vars` に | Task 6 Step 1 |
| §5.4 Turnstile・レート制限 | **A-3。この計画には含めない** |

**2. プレースホルダ走査**

Task 2・3 は「pre-meet の実物を読んで移植」としており、コード全文を転記していない。
**これは意図的。** セキュリティに関わるコードを私が転記し直すと、転記ミスが
そのまま脆弱性になる。変更点（ソルト文字列・`timingSafeEqual`）は逐語で指定した。

**3. 型の整合**

- `normalizeEmail(raw: unknown): string | null` は Task 1 の定義と Task 2・6 の使用で一致
- `deriveClientKey` はブラウザ専用で Worker からは呼ばない（`"paths": {}` で物理的に不可）
- `hashClientKey` / `verifyClientKey` の署名は Task 3 の定義と Task 6 の使用で一致
- `SESSION_COOKIE` / `buildSetCookie` / `readCookie` は Task 4 の定義と Task 6 の使用で一致
- `worker/db.ts` の5関数は Task 5 の定義と Task 6 の使用で一致

**4. 意図的に除外したもの**

- **UI** … A-4
- **パスワード再設定・メール送信** … A-3
- **Turnstile・レート制限** … A-3。**これが無い間は本番に公開しない**
- **`worker/db.ts` のユニットテスト** … D1 のモックは実質的な担保にならないため、
  Task 6 Step 5 の実D1疎通で代替する
