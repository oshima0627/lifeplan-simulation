# Phase 2a: 保存スキーマ v2（安定ID・移行） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 子供と任意イベントの各行に安定IDを持たせ、既存ユーザーの保存内容を失わずに localStorage スキーマを v1 から v2 へ移行する。

**Architecture:** 型に `id` を足し、生成は1箇所のユーティリティに集約する。`loadSheet()` は v2 を読み、無ければ v1 を読んでIDを採番して変換する。UI の `key` をインデックスからIDに切り替える。計算エンジンは `id` を無視するので変更しない。

**Tech Stack:** TypeScript / Vitest / React（既存構成のまま。新規依存なし）

**なぜ今やるか:** Phase 2b（AIヒアリング）はスキーマを変える。そのときに移行を書いていなければ、年1回見直す前提のツールで既存ユーザーの入力が黙って消える。加えて `key={i}` は行の途中削除でIME変換中の状態が別の行に飛ぶ実害があり、Phase 2b では LLM が「第2子」を指し示す安定した手段も要る。**単体で出荷可能で、コスト露出はゼロ。**

## Global Constraints

- 仕様は `docs/requirements.md` が唯一の情報源。特に **§4.1（安定ID）と §4.2（移行）**
- 金額はすべて円（number）、率はすべてパーセント（number）
- 計算ロジックは `src/lib/` 配下の純粋関数として書き、React に依存させない
- テストは実装ファイルと同じディレクトリに `*.test.ts` として置く（jsdom が要るものだけ `*.test.tsx`）
- ドキュメントコメントとテストの説明文は**日本語**で書く
- 数値リテラルは桁区切りを使う
- パスエイリアス `@/` は `src/` を指す
- **Phase 2a ではサーバーサイドのコードを一切書かない。** `src/app/api/` も Worker も作らない（Phase 2b の領域）
- **計算エンジン（`cashflow.ts` / `education.ts` / `scenarios.ts`）のロジックを変えない。** 全体レビューで正しさが独立検証済み。`id` は計算に一切影響してはならない

---

## File Structure

| ファイル | 変更 |
|---|---|
| `src/lib/lifeplan/types.ts` | `Child` と `LifeEvent` に `id: string` を追加 |
| `src/lib/id.ts` | **新規。** 行IDの採番。1箇所に集約する |
| `src/lib/storage.ts` | 保存キーを v2 に。v1 からの移行を実装 |
| `src/components/HearingForm.tsx` | `key={i}` を `key={row.id}` に。行追加時にIDを採番 |
| `src/lib/lifeplan/education.ts` | 変更なし（`Child` を読むが `id` は使わない） |
| `src/lib/lifeplan/cashflow.ts` | 変更なし |

---

### Task 1: 行IDの採番ユーティリティ

**Files:**
- Create: `src/lib/id.ts`
- Test: `src/lib/id.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `newRowId(): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/id.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { newRowId } from "./id";

describe("newRowId", () => {
  it("空でない文字列を返す", () => {
    expect(newRowId()).not.toBe("");
    expect(typeof newRowId()).toBe("string");
  });

  it("呼ぶたびに異なるIDを返す", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newRowId()));
    expect(ids.size).toBe(1_000);
  });

  it("crypto.randomUUID が使えない環境でも動く", () => {
    const original = globalThis.crypto;
    // randomUUID を持たない crypto に差し替える
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });
    try {
      const ids = new Set(Array.from({ length: 100 }, () => newRowId()));
      expect(ids.size).toBe(100);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/id.test.ts
```

期待: FAIL（`newRowId` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/id.ts`:
```ts
/**
 * フォームの行（子供・任意イベント）に振る安定ID。
 *
 * 仕様（docs/requirements.md §4.1）:
 * - 行の作成時に一度だけ採番し、以後変更しない
 * - **内容から導出しない。** 同じ年齢・同じ金額の行が並びうるため、
 *   内容を元にすると衝突して React の key が破綻する
 *
 * `crypto.randomUUID` は安全なコンテキスト（https / localhost）でしか
 * 生えないため、無い環境ではカウンタ併用のフォールバックを使う。
 * ここで採番するIDは表示にもURLにも使わない内部識別子なので、
 * 暗号学的な強度は要らない。要るのは「衝突しないこと」だけ
 */
let counter = 0;

export function newRowId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  counter += 1;
  return `row-${Date.now().toString(36)}-${counter.toString(36)}`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/id.test.ts
```

期待: 3 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/id.ts src/lib/id.test.ts
git commit -m "feat: フォーム行の安定IDを採番するユーティリティを追加"
```

---

### Task 2: 型に id を追加する

**Files:**
- Modify: `src/lib/lifeplan/types.ts`
- Modify: `src/lib/lifeplan/education.test.ts`（フィクスチャに `id` を足す）
- Modify: `src/lib/lifeplan/cashflow.test.ts`（同上）

**Interfaces:**
- Consumes: なし
- Produces: `Child` と `LifeEvent` が `id: string` を持つ

- [ ] **Step 1: 型を変更する**

`src/lib/lifeplan/types.ts` の `Child` と `LifeEvent` に `id` を足す。既存のコメントは残し、`id` に説明を付ける:

```ts
/** 子供1人ぶんの情報 */
export interface Child {
  /**
   * 行の安定ID（docs/requirements.md §4.1）。
   * React の key と、Phase 2b で LLM が特定の行を指すために使う。
   * 計算には一切使わない
   */
  id: string;
  /** 現在年齢（0〜22） */
  age: number;
  /** 進路。全段階に一律で適用する */
  path: EducationPath;
}
```

`LifeEvent` にも同じ形で `id` を足す。

> ⚠️ `LifeEvent` は `buildEducationEvents` の**戻り値**にも使われている。
> 教育費イベントは保存されず毎回生成されるが、型が同じである以上 `id` は必須になる。
> 次のステップで対処する。

- [ ] **Step 2: 型エラーを確認する**

```bash
npm run typecheck
```

期待: FAIL。`education.ts` が `id` の無いオブジェクトを作っている箇所と、テストのフィクスチャでエラーが出る。**この一覧が次に直す場所そのもの。**

- [ ] **Step 3: 教育費イベントにIDを振る**

`src/lib/lifeplan/education.ts` の `events.push({...})` 2箇所に `id: newRowId()` を足し、`@/lib/id` を import する。

教育費イベントはユーザーが編集する行ではないが、`LifeEvent` 型を共有しているのでIDは要る。**採番方法は同じで構わない**（一意でありさえすればよい）。

- [ ] **Step 4: テストのフィクスチャを直す**

`education.test.ts` と `cashflow.test.ts` で `Child` / `LifeEvent` のリテラルを作っている箇所に `id` を足す。テストの**期待値は変えない** — `id` は計算に影響しないので、既存の期待値が変わったらそれは実装のバグ。

例:
```ts
buildEducationEvents([{ id: "c1", age: 6, path: "public" }], 40)
```

- [ ] **Step 5: 全テストと型チェックを通す**

```bash
npm run typecheck
npm test
```

期待: 型エラーなし、全テスト pass。**既存テストの期待値を1つも変えずに通ること**が、`id` が計算に影響していない証拠になる。

- [ ] **Step 6: コミット**

```bash
git add -A src/lib/
git commit -m "feat: Child と LifeEvent に安定IDを追加

id は計算に一切使わない。既存テストの期待値を変えずに通ることで
計算へ影響していないことを担保する。"
```

---

### Task 3: スキーマ v2 と v1 からの移行

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `newRowId`（Task 1）、`Child`/`LifeEvent`（Task 2）
- Produces: `loadSheet()` が v2 を読み、v1 があれば移行して返す

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/storage.test.ts` に追記する（既存の7件は残す）:

```ts
describe("v1 からの移行", () => {
  beforeEach(() => {
    installMockStorage();
  });

  /** id を持たない旧スキーマのシート */
  const V1_SHEET = {
    currentAge: 45,
    occupation: "employee",
    householdNetIncome: 7_000_000,
    annualLivingCost: 4_200_000,
    savings: 2_000_000,
    investments: 8_000_000,
    retirementAge: 62,
    children: [
      { age: 10, path: "public" },
      { age: 7, path: "private" },
    ],
    customEvents: [{ age: 50, amount: 30_000_000, label: "住宅購入" }],
  };

  it("v1 しか無ければ読み出して v2 に変換する", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet();
    expect(loaded).not.toBeNull();
    expect(loaded!.currentAge).toBe(45);
    expect(loaded!.children).toHaveLength(2);
    expect(loaded!.customEvents).toHaveLength(1);
  });

  it("移行後、すべての行がIDを持つ", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet()!;
    for (const c of loaded.children!) {
      expect(c.id).toBeTruthy();
    }
    for (const e of loaded.customEvents!) {
      expect(e.id).toBeTruthy();
    }
  });

  it("移行後のIDは行ごとに異なる", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    const loaded = loadSheet()!;
    const ids = [
      ...loaded.children!.map((c) => c.id),
      ...loaded.customEvents!.map((e) => e.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("移行に成功したら v2 に保存し v1 を消す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    loadSheet();
    expect(localStorage.getItem("lifeplan.sheet.v2")).not.toBeNull();
    expect(localStorage.getItem("lifeplan.sheet.v1")).toBeNull();
  });

  it("v2 があれば v1 を見にいかない", () => {
    const v2 = { ...V1_SHEET, currentAge: 33, children: [], customEvents: [] };
    localStorage.setItem("lifeplan.sheet.v2", JSON.stringify(v2));
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(V1_SHEET));
    expect(loadSheet()!.currentAge).toBe(33);
    // v1 は残したまま。触っていないので消してはいけない
    expect(localStorage.getItem("lifeplan.sheet.v1")).not.toBeNull();
  });

  it("v1 が壊れていても例外を投げず、v1 を消さない", () => {
    localStorage.setItem("lifeplan.sheet.v1", "{壊れている");
    expect(loadSheet()).toBeNull();
    // 消してから失敗すると復旧手段が無くなる
    expect(localStorage.getItem("lifeplan.sheet.v1")).not.toBeNull();
  });

  it("v1 の必須項目が欠けていれば移行せず null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify({ currentAge: 40 }));
    expect(loadSheet()).toBeNull();
    expect(localStorage.getItem("lifeplan.sheet.v2")).toBeNull();
  });

  it("children や customEvents が無い v1 も移行できる", () => {
    const minimal = { ...V1_SHEET };
    delete (minimal as Record<string, unknown>).children;
    delete (minimal as Record<string, unknown>).customEvents;
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify(minimal));
    const loaded = loadSheet();
    expect(loaded).not.toBeNull();
    expect(loaded!.children).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/storage.test.ts
```

期待: FAIL（移行が未実装なので v1 が読まれない）

- [ ] **Step 3: 実装を書く**

`src/lib/storage.ts` を変更する:

```ts
/** 保存キー。スキーマを壊す変更をしたら番号を上げ、移行を書く */
const STORAGE_KEY = "lifeplan.sheet.v2";
/** 旧スキーマ（行に id が無い）のキー。移行元としてだけ読む */
const LEGACY_KEY_V1 = "lifeplan.sheet.v1";
```

`isValidSheet` は据え置き（`id` の有無は検証しない。移行で必ず埋まるため）。

移行関数を足す:

```ts
/**
 * v1（行に id が無い）を v2 に変換する。
 *
 * 仕様（docs/requirements.md §4.2）:
 * - 変換に成功したときだけ v2 に保存し、v1 を消す
 * - **失敗したら v1 を消さない。** 消してから失敗すると復旧手段が無くなる
 */
function migrateV1(raw: string): HearingSheet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidSheet(parsed)) return null;

  const sheet = parsed as HearingSheet;
  return {
    ...sheet,
    children: sheet.children?.map((c) => ({ ...c, id: newRowId() })),
    customEvents: sheet.customEvents?.map((e) => ({ ...e, id: newRowId() })),
  };
}
```

`loadSheet` を書き換える:

```ts
export function loadSheet(): HearingSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      return isValidSheet(parsed) ? parsed : null;
    }

    // v2 が無いときだけ旧スキーマを見にいく
    const legacy = localStorage.getItem(LEGACY_KEY_V1);
    if (!legacy) return null;

    const migrated = migrateV1(legacy);
    if (!migrated) return null;

    // 変換できたときだけ、保存してから旧キーを消す
    saveSheet(migrated);
    localStorage.removeItem(LEGACY_KEY_V1);
    return migrated;
  } catch {
    return null;
  }
}
```

`@/lib/id` の `newRowId` を import する。

- [ ] **Step 4: 全テストを通す**

```bash
npm test
```

期待: 既存7件＋新規8件を含め全件 pass

- [ ] **Step 5: コミット**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: 保存スキーマを v2 にし、v1 からの移行を実装

loadSheet() が不一致で null を返すままスキーマを変えると、既存ユーザーの
保存内容が黙って消える。年1回見直す前提のツールでは許容できない。
変換に成功したときだけ v1 を削除し、失敗時は復旧手段として残す。"
```

---

### Task 4: フォームの key をIDに切り替える

**Files:**
- Modify: `src/components/HearingForm.tsx`
- Create: `src/components/HearingForm.test.tsx`

**Interfaces:**
- Consumes: `newRowId`（Task 1）、`Child`/`LifeEvent`（Task 2）
- Produces: 行の追加時にIDを採番し、`key` にIDを使うフォーム

- [ ] **Step 1: 失敗するテストを書く**

`src/components/HearingForm.test.tsx`（jsdom が要るので `.tsx`。既存の `Simulator.test.tsx` と同じ環境指定の書き方に合わせる）:

```tsx
// @vitest-environment jsdom
//
// 行の同一性（key）を検証するので jsdom が要る。
// 環境指定の作法は src/components/Simulator.test.tsx に合わせている

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { HearingForm } from "./HearingForm";

afterEach(() => {
  cleanup();
});

const BASE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("HearingForm の行操作", () => {
  it("子供を追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<HearingForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    expect(latest.children).toHaveLength(1);
    expect(latest.children![0].id).toBeTruthy();
  });

  it("2人追加すると異なるIDになる", () => {
    let latest: HearingSheet = BASE;
    const { rerender } = render(
      <HearingForm sheet={latest} onChange={(s) => (latest = s)} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    rerender(<HearingForm sheet={latest} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "子供を追加" }));
    expect(latest.children![0].id).not.toBe(latest.children![1].id);
  });

  it("真ん中の行を削除しても残る行のIDが変わらない", () => {
    const withThree: HearingSheet = {
      ...BASE,
      children: [
        { id: "a", age: 10, path: "public" },
        { id: "b", age: 7, path: "public" },
        { id: "c", age: 4, path: "public" },
      ],
    };
    let latest: HearingSheet = withThree;
    render(<HearingForm sheet={withThree} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "第2子を削除" }));
    expect(latest.children!.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("任意イベントを追加するとIDが振られる", () => {
    let latest: HearingSheet = BASE;
    render(<HearingForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.click(screen.getByRole("button", { name: "大きな支出の予定を追加" }));
    expect(latest.customEvents![0].id).toBeTruthy();
  });
});
```

> ⚠️ **実装の現状を確認済み。** `HearingForm.tsx:203` と `:275` の「追加」ボタンには
> `aria-label` が無く、両方とも読み上げ名が「追加」になる。上のテストが要求する
> `子供を追加` / `大きな支出の予定を追加` になるよう、実装側に `aria-label` を足す（下の Step 3）。
> 削除ボタンは `:244` `:334` で既に行を特定できる `aria-label` を持っているので、そのまま使える。
>
> これは付随的な a11y 改善でもある — 「追加」だけでは何を追加するのか読み上げで分からない。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/components/HearingForm.test.tsx
```

期待: FAIL

- [ ] **Step 3: 実装を変更する**

`src/components/HearingForm.tsx`:

1. `@/lib/id` から `newRowId` を import する
2. 子供の追加を `{ id: newRowId(), age: 0, path: "public" }` にする
3. イベントの追加を `{ id: newRowId(), age: sheet.currentAge + 5, amount: 30_000_000, label: "住宅購入" }` にする
4. **`key={i}` を `key={child.id}` / `key={event.id}` に変える**
5. 「追加」ボタンに `aria-label="子供を追加"` / `aria-label="大きな支出の予定を追加"` を足す

`map` の `index` は `第${i + 1}子` のラベル表示と削除の `aria-label` に引き続き使ってよい（**表示順の話であって、行の同一性の話ではない**）。

- [ ] **Step 4: テストを通す**

```bash
npm test
npm run typecheck
npm run lint
```

期待: 全件 pass、型・lint エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/HearingForm.tsx src/components/HearingForm.test.tsx
git commit -m "fix: フォーム行の key を配列インデックスから安定IDに変更

行の途中を削除すると、React が位置で DOM を再利用するため
フォーカスやIME変換中の状態が別の行に付け替わっていた。
あわせて「追加」ボタンに何を追加するのか分かる aria-label を付けた。"
```

---

### Task 5: 移行の実機確認とドキュメント更新

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1〜4 のすべて
- Produces: 移行が実際に効くことの確認と、記録

- [ ] **Step 1: 全体の検証を通す**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

期待: すべて pass

- [ ] **Step 2: 移行を実機で確認する**

```bash
npm run dev
```

ブラウザで <http://localhost:3000> を開き、以下を順に確認する:

1. DevTools のコンソールで、**旧スキーマを手で仕込む**:
   ```js
   localStorage.removeItem("lifeplan.sheet.v2");
   localStorage.setItem("lifeplan.sheet.v1", JSON.stringify({
     currentAge: 45, occupation: "employee",
     householdNetIncome: 7000000, annualLivingCost: 4200000,
     savings: 2000000, investments: 8000000, retirementAge: 62,
     children: [{ age: 10, path: "public" }, { age: 7, path: "private" }],
     customEvents: [{ age: 50, amount: 30000000, label: "住宅購入" }]
   }));
   ```
2. ページを再読み込みし、**45歳・子供2人・住宅購入が復元されている**ことを確認する
3. コンソールで `localStorage.getItem("lifeplan.sheet.v1")` が `null`、`localStorage.getItem("lifeplan.sheet.v2")` が値を持つことを確認する
4. 子供を3人に増やし、**真ん中の行を削除**して、残った2行の入力内容が正しく残る（ずれない）ことを確認する

**実機で確認できない場合は、その旨を報告に明記する。** 確認したと書かないこと。

- [ ] **Step 3: README を更新する**

`README.md` の「構成」表に `src/lib/id.ts` の行を足し、「現状」節を更新する:

```markdown
## 現状

Phase 1（フォーム入力）と Phase 2a（保存スキーマ v2・安定ID）まで実装済み。
Phase 2b でAIヒアリング層を載せる予定（[docs/requirements.md §3](docs/requirements.md)）。
**Phase 2b の公開前に AI Gateway の Budget Limit を設定すること**
（[§7.1](docs/requirements.md) に推奨値）。
```

- [ ] **Step 4: コミット**

```bash
git add README.md
git commit -m "docs: Phase 2a の完了を README に反映"
```

---

## Phase 2a 完了条件

- [ ] `npm test` が全件 pass する（Phase 1 の78件＋今回の追加分）
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` がエラーなし
- [ ] **既存テストの期待値を1つも変えていない**（`id` が計算に影響していない証拠）
- [ ] v1 の保存内容が実機で v2 に移行され、内容が失われない
- [ ] v1 が壊れているとき、v1 が消えずに残る
- [ ] 真ん中の行を削除しても、残る行の内容がずれない

## Phase 2b への引き継ぎ

| 前提 | 状態 |
|---|---|
| 行の安定ID | Phase 2a で完了。LLM が「第2子」を指せる |
| スキーマ移行の仕組み | Phase 2a で完了。v2→v3 も同じ形で書ける |
| **AI Gateway の Budget Limit** | **未設定。公開前の必須ゲート**（→ §7.1: 月$30 推奨） |
| Turnstile / Durable Object | 未着手 |
| 静的エクスポートと Worker の共存構成 | 未検証。`wrangler.jsonc` に `main` を足す形になる |
