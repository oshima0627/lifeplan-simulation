# サブプロジェクトA-4：認証のUI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作成済みの認証APIに、人が触れる画面を付ける。登録・ログイン・ログアウト・パスワード再設定ができるようにする。

**Architecture:** 静的エクスポートのページから `fetch` でWorkerのAPIを叩く。パスワードはブラウザでPBKDF2を60万回回して鍵に変え、**本体は送らない。** 登録画面には Turnstile を埋め込む。

**Tech Stack:** Next.js 16（静的エクスポート）/ React 19 / Tailwind v4 / Vitest 4 + @testing-library/react

## Global Constraints

- 設計の正は `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` **§5**
- **静的エクスポート（`output: "export"`）を崩さない。** サーバーコンポーネントでのデータ取得をしない
- **`src/lib/auth/kdf.ts` を変更しない**（レビュー済み。PBKDF2 60万回・ソルトはメール由来）
- **`worker/` 以下を変更しない。** このサブプロジェクトはUIだけ
- **`src/lib/lifeplan/` と既存の試算UIを壊さない**
- 既存テスト398件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **`git add` は変更したファイルを明示的に列挙する。`git add -A` は使わない**
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる
- **push とデプロイはしない。** 制御側が行う

### 既に動いているAPI（変更しない）

| ルート | 入力 | 応答 |
|---|---|---|
| `POST /api/auth/signup` | `{ email, key, kdfVersion, turnstileToken }` | 成功: `200` + `Set-Cookie` ／ 重複: `409 EMAIL_TAKEN` ／ Turnstile失敗: `403 TURNSTILE_FAILED` ／ 上限: `429 RATE_LIMITED` |
| `POST /api/auth/login` | `{ email, key, kdfVersion }` | 成功: `200` + `Set-Cookie` ／ 失敗: `401 AUTH_FAILED` ／ 上限: `429 RATE_LIMITED` |
| `POST /api/auth/logout` | なし | `200` + Cookie失効 |
| `GET /api/auth/me` | なし | `{ userId: string \| null }` |
| `POST /api/auth/forgot-password` | `{ email }` | **常に `200 { ok: true }`** |
| `POST /api/auth/reset-password` | `{ token, key, kdfVersion }` | 成功: `200` ／ 無効: `400 RESET_TOKEN_INVALID` |

### Turnstile

| | |
|---|---|
| サイトキー | `0x4AAAAAAENnTBKLgFfFwJKa`（公開値。ソースに直書きしてよい） |
| スクリプト | `https://challenges.cloudflare.com/turnstile/v0/api.js` |
| モード | Managed |

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/lib/auth/client.ts`（新規） | APIを叩く関数群。**鍵導出もここで行う** |
| `src/lib/auth/client.test.ts`（新規） | 上記のテスト |
| `src/components/auth/AuthForm.tsx`（新規） | 登録・ログイン共通のフォーム部品 |
| `src/components/auth/AuthForm.test.tsx`（新規） | 上記のテスト |
| `src/components/auth/Turnstile.tsx`（新規） | Turnstile ウィジェットの埋め込み |
| `src/components/auth/AccountNav.tsx`（新規） | ヘッダーのログイン状態表示 |
| `src/components/auth/AccountNav.test.tsx`（新規） | 上記のテスト |
| `src/app/signup/page.tsx` / `login` / `account` / `forgot-password` / `reset-password`（新規） | 各画面 |
| `src/app/layout.tsx`（変更） | ヘッダーに `AccountNav` を置く |

---

### Task 1: APIクライアント

**Files:** Create `src/lib/auth/client.ts`, `src/lib/auth/client.test.ts`

**Interfaces:**

```ts
export type AuthResult = { ok: true } | { ok: false; code: string; message: string };

export function signup(input: { email: string; password: string; turnstileToken: string }, fetchImpl?: typeof fetch): Promise<AuthResult>
export function login(input: { email: string; password: string }, fetchImpl?: typeof fetch): Promise<AuthResult>
export function logout(fetchImpl?: typeof fetch): Promise<void>
export function fetchMe(fetchImpl?: typeof fetch): Promise<string | null>
export function requestPasswordReset(email: string, fetchImpl?: typeof fetch): Promise<void>
export function resetPassword(input: { token: string; password: string }, fetchImpl?: typeof fetch): Promise<AuthResult>
```

**必ず守ること:**

- **パスワード本体をAPIに送らない。** `deriveClientKey(email, password)` で鍵にしてから送る
- **`credentials: "same-origin"` を指定する。** Cookie が送受信されない
- **サーバーのエラー文言をそのまま表示に使う。** クライアント側で言い換えると、
  「存在を明かさない」ために揃えた文言が崩れる
- **`fetch` を差し替えられる形にする**（テストが実際に通信しないため）
- 鍵導出は重い（PBKDF2 60万回で0.2〜0.6秒）。**呼び出し側がローディング表示を出せるよう、Promiseを返すだけにする**

**テストで検証すること:**

- `signup` / `login` が**パスワード本体を送っていない**こと（送信ボディに `password` が無く、43文字の `key` があること）
- メールの大文字小文字が違っても同じ鍵になること
- `credentials: "same-origin"` が付くこと
- エラー応答（409 / 401 / 403 / 429）で `{ ok: false, code, message }` を返すこと
- **サーバーの `message` をそのまま返すこと**（言い換えていないこと）
- `fetchMe` が `{userId: null}` で `null` を返すこと
- ネットワークエラーで例外を投げず `{ ok: false }` を返すこと

- [ ] **Step 1〜5**: テスト先行で実装し、コミット（`feat: 認証APIのクライアント`）

---

### Task 2: Turnstile ウィジェット

**Files:** Create `src/components/auth/Turnstile.tsx`

**Interfaces:** `<TurnstileWidget onToken={(token: string) => void} />`

**必ず守ること:**

- スクリプトを**重複して読み込まない**（`document.querySelector` で既存を確認する）
- **アンマウント時にウィジェットを片付ける**（React の StrictMode で二重マウントされるため）
- **トークンには有効期限がある（5分）。** 期限切れのコールバックで `onToken("")` を呼び、
  呼び出し側が送信ボタンを無効化できるようにする
- サイトキー `0x4AAAAAAENnTBKLgFfFwJKa` は**公開値なので直書きしてよい**

⚠️ **このコンポーネントにユニットテストは書かない。** Turnstile のスクリプトは外部から読み込まれ、
jsdom では動かない。モックすると「モックの振る舞い」を検証するだけになる。
**実際の動作確認は Task 5 の本番目視で行う。**

- [ ] **Step 1〜3**: 実装し、型検査を通し、コミット（`feat: Turnstile ウィジェット`）

---

### Task 3: 認証フォームとログイン状態表示

**Files:** Create `src/components/auth/AuthForm.tsx`, `AuthForm.test.tsx`, `AccountNav.tsx`, `AccountNav.test.tsx`

**`AuthForm`:**

```ts
<AuthForm mode="signup" | "login" />
```

- メール・パスワードの入力
- **`mode="signup"` のときだけ Turnstile を表示**し、トークンが無ければ送信ボタンを無効化
- **鍵導出中はローディングを表示する**（0.2〜0.6秒かかる。無反応に見えると二重送信される）
- **送信中はボタンを無効化する**（二重送信の防止）
- エラーは**サーバーの文言をそのまま**表示
- 成功したらトップページへ遷移

⚠️ **パスワードの長さ検証はブラウザ側の助言に留まる。** サーバーには鍵しか届かないので
検証できない。`PASSWORD_MIN_LENGTH`（8）と `PASSWORD_MAX_LENGTH`（200）を使い、
**「サーバーでは検証できないので、ここでの表示は助言である」ことをコメントに書く**

**`AccountNav`:**

- マウント後に `fetchMe()` を呼び、ログイン状態を表示
- 未ログイン: 「ログイン」「登録」へのリンク
- ログイン済み: 「アカウント」リンクと「ログアウト」ボタン
- ⚠️ **静的エクスポートなので、初回HTMLは常に「未ログイン」の状態で生成される。**
  マウント後に差し替えるため、**`useEffect` 内で `fetchMe` を呼ぶ**こと。
  レンダー中に呼ぶと hydration 不一致になる

**テストで検証すること（jsdom）:**

- `AuthForm` がパスワードを `type="password"` で受け取ること
- **`mode="signup"` でトークンが無いとき送信ボタンが無効**なこと
- 送信中にボタンが無効になること
- エラー時にサーバーの文言が表示されること
- `AccountNav` が未ログインで「ログイン」を表示し、ログイン済みで「ログアウト」を表示すること

- [ ] **Step 1〜5**: テスト先行で実装し、コミット（`feat: 認証フォームとログイン状態表示`）

---

### Task 4: 画面とレイアウト

**Files:** Create `src/app/{signup,login,account,forgot-password,reset-password}/page.tsx`; Modify `src/app/layout.tsx`

**各画面:**

| パス | 内容 |
|---|---|
| `/signup` | `<AuthForm mode="signup" />` ＋ ログインへの導線 |
| `/login` | `<AuthForm mode="login" />` ＋ 登録・パスワード再設定への導線 |
| `/account` | ログイン状態の表示とログアウト。**未ログインならログインへ促す** |
| `/forgot-password` | メール入力。**送信後は常に同じ文言**（「登録されていれば送信しました」） |
| `/reset-password` | URLの `token` を読んで新しいパスワードを設定 |

**必ず守ること:**

- **`/reset-password` で、トークンをURLから消す。** `history.replaceState` を使う。
  そのままだと Referer やブラウザ履歴から漏れる（設計書 §11.1 の宿題3）
- **`/forgot-password` の送信後の文言を、アドレスの有無で変えない。**
  APIが常に `200` を返すので、画面も常に同じ文言にする
- **`/account` は静的エクスポートなので、初回HTMLは未ログイン状態。** マウント後に差し替える

**`layout.tsx`:**

- ヘッダーに `AccountNav` を置く
- ⚠️ **`layout.tsx` はサーバーコンポーネント。** `AccountNav` は `"use client"` にする

- [ ] **Step 1〜4**: 実装し、テストを通し、コミット（`feat: 認証の画面`）

---

### Task 5: 本番デプロイと目視確認

**これは制御側（私）が行う。** 実装者はここまで。

1. `npm run deploy`
2. **実際にアカウントを作り、ログイン・ログアウト・再設定まで通す**
3. Turnstile が実際に表示され、通過すること
4. パスワード再設定のメールが**実際に届く**こと
5. 既存の試算UIが壊れていないこと

---

## Self-Review

**1. 仕様カバレッジ**

| 設計書 | タスク |
|---|---|
| §5.1 パスワード本体を送らない | Task 1（テストで固定） |
| §5.4 Turnstile を登録フォームに | Task 2・3 |
| §11.1 宿題3（トークンをURLから消す） | Task 4 |

**2. 意図的にやらないこと**

- **Stripe（B）・AI層（C）・法務（D）** は範囲外
- **`Turnstile.tsx` のユニットテスト。** 外部スクリプト依存でモックしても意味が無い。本番目視で代替
- **メール確認（signup の到達性確認）。** 設計書 §11.1 の宿題2。**C の着手前に別途行う**

**3. リスク**

- **静的エクスポートと認証状態の食い違い。** 初回HTMLは常に未ログインなので、
  マウント後に差し替える必要がある。レンダー中に読むと hydration 不一致
- **Turnstile が jsdom で動かない。** テストではなく本番目視で確認する
