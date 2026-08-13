# 左フォーム・右グラフ固定の2カラム 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 広い画面は左に入力フォーム（縦スクロール）・右にグラフ（固定）の2カラムにし、狭い画面はグラフだけを見せて入力はボタンからポップアップで行う。

**Architecture:** 表示層だけの変更。`Simulator` が持つ `sheet` の流れは変えない。横スクロールバー（`BasicInfoBar` / `BarField`）を削除し、基本情報を `SelectField` の縦積み（`BasicInfoFields`）に戻す。警告行は `InputWarnings` として切り出し、左カラムが消える狭い画面でも見えるよう右の固定領域に置く。

**Tech Stack:** Next.js 16（静的エクスポート）/ React 19 / Tailwind CSS v4 / Vitest 4 + @testing-library/react / recharts

**設計書:** [docs/superpowers/specs/2026-08-14-two-column-fixed-chart-design.md](../specs/2026-08-14-two-column-fixed-chart-design.md)

## Global Constraints

- **計算エンジン（`src/lib/lifeplan/`）・保存スキーマ（`src/lib/storage.ts`）・`worker/` を変更しない。** 表示層だけの変更である
- **コメントは日本語で、「なぜそうしているか」を書く。** 既存ファイルの書き方に合わせる
- **`role="status"` を使う。`role="alert"` も `role="banner"` も使わない。** 前者は値を変えるたびに読み上げが割り込む。後者はサイトヘッダのランドマークであって告知バーの role ではない
- **`role="status"` の要素は常に描画し、中身だけを出し入れする。** 要素ごと出し入れすると、ライブリージョンが中身と同時に DOM へ挿入され、読み上げが発火しないことがある
- **固定領域の祖先に `overflow: hidden / auto / scroll` を足さない。** `position: sticky` がエラーも出さずに効かなくなる。CSS で足すか実行時に JS で `document.body` に足すかは関係ない
- **プレースホルダをラベルの代用にしない**
- **ポップアップ（`HearingModal`）・`Steps`・`VerdictSummary`・`verdict.ts`・`SelectField` を変更しない**
- DOM 環境が要るテストファイルは先頭に `// @vitest-environment jsdom` を書く（`vitest.config.mts` の既定は node）
- テストは `npm test`、型は `npm run typecheck`、lint は `npm run lint`、ビルドは `npm run build`

---

### Task 1: `InputWarnings`（警告行を独立させる）

**Files:**
- Create: `src/components/InputWarnings.tsx`
- Test: `src/components/InputWarnings.test.tsx`

**Interfaces:**
- Consumes: `isRetirementAgeInvalid` / `isPensionStartAgeInvalid` from `@/lib/lifeplan/guards`
- Produces:
  ```ts
  export function InputWarnings(props: { sheet: HearingSheet }): React.JSX.Element
  ```

**なぜ切り出すのか:** 今この警告は `BasicInfoBar` の中にある。`BasicInfoBar` は次のタスクで消えるが、警告そのものは残す必要がある。**しかも置き場所が左カラムではなく右の固定領域に変わる**ので、入力欄と同じ部品に同居させられない。

**⚠️ 表示される文字列を1文字も変えないこと。** 既存の `BasicInfoBar.test.tsx` が同じ文言を検証しており、移設は文言の変更ではない。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/InputWarnings.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// 警告の出し分けと role="status" の常設を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { InputWarnings } from "./InputWarnings";

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

describe("InputWarnings", () => {
  it("入力が妥当でも role=status の要素は常に描画される", () => {
    // ⚠️ 要素ごと出し入れすると、ライブリージョンが中身と同時にDOMへ挿入され、
    // スクリーンリーダーの実装によっては読み上げが発火しない
    render(<InputWarnings sheet={BASE} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("入力が妥当なら中身は空", () => {
    render(<InputWarnings sheet={BASE} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("リタイア年齢が現在年齢を下回ると警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<InputWarnings sheet={sheet} />);
    expect(screen.getByRole("status")).toHaveTextContent(/給与収入が全期間0円/);
  });

  it("年金の受給開始年齢が現在年齢を下回ると、直し方つきの警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 };
    const status = (render(<InputWarnings sheet={sheet} />), screen.getByRole("status"));
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
    expect(status).toHaveTextContent(/現在の年齢以上に修正してください/);
  });

  it("2つとも不正なら両方の文言が1つの status に出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 65, pensionStartAge: 65 };
    render(<InputWarnings sheet={sheet} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/給与収入が全期間0円/);
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/InputWarnings.test.tsx`
Expected: FAIL（`Failed to resolve import "./InputWarnings"`）

- [ ] **Step 3: 実装する**

`src/components/InputWarnings.tsx`:

```tsx
"use client";

import { isPensionStartAgeInvalid, isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet } from "@/lib/lifeplan/types";

/**
 * 「黙って間違う」入力を知らせる行。
 *
 * ⚠️ 左の入力カラムではなく、右の固定領域に置く。狭い画面（1024px未満）では
 * 左カラムごと入力欄が消えるため、警告を入力欄の隣に置くと
 * 「試算が黙って間違っている」ことに一度も気づけない（設計書 §4）。
 *
 * ⚠️ role="alert" は使わない。値を変えるたびに読み上げが割り込む。
 * 助言は role="status"。role="banner" はサイトヘッダのランドマークなので論外。
 *
 * ⚠️ role="status" の要素自体は警告の有無に関わらず常に描画し、中身だけを
 * 出し入れする。要素ごと出し入れすると、ライブリージョンが中身と同時にDOMへ
 * 挿入されることになり、スクリーンリーダーの実装によっては読み上げが発火しない。
 * 警告が無いときに枠線や余白が目に見えないよう、装飾のクラスは中身がある場合にだけ付ける
 */
export function InputWarnings({ sheet }: { sheet: HearingSheet }) {
  const retirementInvalid = isRetirementAgeInvalid(sheet);
  const pensionInvalid = isPensionStartAgeInvalid(sheet);

  return (
    <div
      role="status"
      className={
        retirementInvalid || pensionInvalid
          ? "rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
          : undefined
      }
    >
      {retirementInvalid && (
        <p>
          ⚠️ リタイア予定年齢が現在の年齢より前になっています。この状態では
          給与収入が全期間0円として試算されます
        </p>
      )}
      {pensionInvalid && (
        // フォーム側（OptionalDetailsForm）の同じ警告と完全に同一の文言にはしていない。
        // こちらは項目が離れた場所にあるため項目名を含める必要があるが、
        // フォーム側は項目のすぐ隣に出るので項目名を繰り返す必要がない
        <p>⚠️ 年金の受給開始年齢が現在の年齢より前になっています。現在の年齢以上に修正してください</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- src/components/InputWarnings.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: コミットする**

```bash
git add src/components/InputWarnings.tsx src/components/InputWarnings.test.tsx && git commit -m "feat(ui): 警告行を InputWarnings として独立させる"
```

---

### Task 2: `BasicInfoFields` と `DerivedSummary` の復帰

**Files:**
- Create: `src/components/BasicInfoFields.tsx`
- Test: `src/components/BasicInfoFields.test.tsx`
- Modify: `src/components/DerivedSummary.tsx`

**Interfaces:**
- Consumes: `SelectField` from `./SelectField`、`DerivedSummary` from `./DerivedSummary`、`formatCompactYen` from `@/lib/format`、`isRetirementAgeInvalid` from `@/lib/lifeplan/guards`、選択肢 from `@/lib/options`
- Produces:
  ```ts
  export function BasicInfoFields(props: {
    sheet: HearingSheet;
    onChange: (sheet: HearingSheet) => void;
  }): React.JSX.Element
  ```

**中身:** 基本情報7項目を `SelectField` で縦積みし、最後に `DerivedSummary` を置く。
2026-08-13 の変更で `HearingForm` から削除したセクションと同じ内容を戻す。

**⚠️ ヒント文を戻すこと。** バーに収まらないので外していたが、縦積みなら入る。

**⚠️ 警告の文言をここに書かないこと。** 警告は `InputWarnings`（Task 1）が持つ。
ここでやるのは、リタイア予定年齢の入力欄を琥珀色にすることだけ。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/BasicInfoFields.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// ラベルと入力の結び付き・7項目の描画を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { BasicInfoFields } from "./BasicInfoFields";

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

describe("BasicInfoFields", () => {
  it("基本情報の7項目が並ぶ", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    for (const label of [
      "現在の年齢",
      "職業",
      "世帯手取り年収",
      "年間の基本生活費",
      "現在の貯金",
      "現在の投資額",
      "リタイア予定年齢",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("ヒント文が出る（縦積みなので入る）", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    expect(screen.getByText("配偶者がいれば合算した額")).toBeInTheDocument();
    expect(screen.getByText("利回りがつかない現金")).toBeInTheDocument();
  });

  it("項目を変えるとシート全体を返す", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoFields sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
    expect(latest.retirementAge).toBe(65);
  });

  it("職業を変えられる", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoFields sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("職業"), { target: { value: "self_employed" } });
    expect(latest.occupation).toBe("self_employed");
  });

  it("リタイア年齢が不正なとき、その項目に aria-invalid が立つ", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoFields sheet={sheet} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("警告の文言はここには書かない（InputWarnings が持つ）", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoFields sheet={sheet} onChange={() => {}} />);
    expect(screen.queryByText(/給与収入が全期間0円/)).not.toBeInTheDocument();
  });

  it("年間収支（自動計算）が出る", () => {
    render(<BasicInfoFields sheet={BASE} onChange={() => {}} />);
    // 600万 − 360万 = 240万
    expect(screen.getByText("2,400,000円")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/BasicInfoFields.test.tsx`
Expected: FAIL（`Failed to resolve import "./BasicInfoFields"`）

- [ ] **Step 3: `BasicInfoFields` を実装する**

`src/components/BasicInfoFields.tsx`:

```tsx
"use client";

import { formatCompactYen } from "@/lib/format";
import { isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  LIVING_COST_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { DerivedSummary } from "./DerivedSummary";
import { SelectField } from "./SelectField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/**
 * 基本情報（Tier 1）の入力。左カラムの一番上に置く。
 *
 * ⚠️ 警告の文言はここに書かない。InputWarnings が右の固定領域で持つ。
 * 狭い画面ではこのカラムごと消えるため、警告をここに置くと見えなくなる（設計書 §4）。
 * ここでやるのは、不正な入力欄の枠を琥珀色にして aria-invalid を立てることだけ
 */
export function BasicInfoFields({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-bold text-slate-800">基本情報</h2>

      <SelectField
        label="現在の年齢"
        value={sheet.currentAge}
        options={CURRENT_AGE_OPTIONS}
        onChange={(v) => set("currentAge", v)}
        suffix="歳"
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">職業</span>
        <select
          className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
          value={sheet.occupation}
          onChange={(e) => set("occupation", e.target.value as Occupation)}
        >
          {(Object.keys(OCCUPATION_LABELS) as Occupation[]).map((key) => (
            <option key={key} value={key}>
              {OCCUPATION_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <SelectField
        label="世帯手取り年収"
        value={sheet.householdNetIncome}
        options={INCOME_OPTIONS}
        onChange={(v) => set("householdNetIncome", v)}
        format={formatCompactYen}
        hint="配偶者がいれば合算した額"
      />

      <SelectField
        label="年間の基本生活費"
        value={sheet.annualLivingCost}
        options={LIVING_COST_OPTIONS}
        onChange={(v) => set("annualLivingCost", v)}
        format={formatCompactYen}
        hint="月30万円なら 360万円"
      />

      <SelectField
        label="現在の貯金"
        value={sheet.savings}
        options={ASSET_OPTIONS}
        onChange={(v) => set("savings", v)}
        format={formatCompactYen}
        hint="利回りがつかない現金"
      />

      <SelectField
        label="現在の投資額"
        value={sheet.investments}
        options={ASSET_OPTIONS}
        onChange={(v) => set("investments", v)}
        format={formatCompactYen}
        hint="利回りが適用される資産"
      />

      <SelectField
        label="リタイア予定年齢"
        value={sheet.retirementAge}
        options={RETIREMENT_AGE_OPTIONS}
        onChange={(v) => set("retirementAge", v)}
        suffix="歳"
        invalid={isRetirementAgeInvalid(sheet)}
      />

      <DerivedSummary sheet={sheet} />
    </section>
  );
}
```

**⚠️ `SelectField` は現在 `invalid` を受け取らない。** 次の Step で足す。

- [ ] **Step 4: `SelectField` に `invalid` を足す**

`src/components/SelectField.tsx` の props に `invalid?: boolean` を追加し、
`<select>` に `aria-invalid` と枠の色を反映させる。**それ以外は変えない。**

props の型に1行足す:

```tsx
  hint?: string;
  /** 真なら枠を琥珀色にし aria-invalid を立てる。文言は InputWarnings が持つ */
  invalid?: boolean;
```

分割代入に `invalid` を足し、`<select>` を次にする:

```tsx
        <select
          id={id}
          // 枠の色だけでは色覚特性によって伝わらない。支援技術にも同じことを伝える
          aria-invalid={invalid ? true : undefined}
          className={`w-full rounded border px-3 py-2 tabular-nums focus:outline-none ${
            invalid
              ? "border-amber-500 bg-amber-50 focus:border-amber-600"
              : "border-slate-300 focus:border-slate-500"
          }`}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
```

**この変更は既存の呼び出し側に影響しない**（`invalid` を渡さなければ従来と同じ見た目になる）。

- [ ] **Step 5: `DerivedSummary` に年額を戻す**

`src/components/DerivedSummary.tsx` の `return` を次にする。年額のバッジを持っていた
`BasicInfoBar` が消えるので、ここが唯一の表示場所に戻る。

```tsx
  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isNegative ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
      {/*
        年額をここに戻した。以前は基本情報バーのバッジが出していたが、
        バーごと廃止したのでここが唯一の表示場所になる
      */}
      <div className="font-medium text-slate-700">年間収支（自動計算）</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          isNegative ? "text-red-700" : "text-slate-900"
        }`}
      >
        {formatYen(annualBalance)}
      </div>
      <div className="mt-1 text-slate-600">月あたり {formatYen(monthly)}</div>
      <p className="mt-2 text-xs text-slate-500">
        {isNegative
          ? "支出が収入を上回っています。生活費の入力が実態と合っているか確認してください。"
          : "これは基本生活費だけを差し引いた金額で、教育費やライフイベント費は含みません。実感と大きくずれていれば、生活費の入力を見直してください。"}
      </p>
    </div>
  );
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test -- src/components/BasicInfoFields.test.tsx`
Expected: PASS（7件）

- [ ] **Step 7: テスト全体を実行する**

Run: `npm test`
Expected: PASS（`BasicInfoBar.test.tsx` を含め全件。`SelectField` の変更は後方互換なので既存は落ちない）

- [ ] **Step 8: コミットする**

```bash
git add src/components/BasicInfoFields.tsx src/components/BasicInfoFields.test.tsx src/components/SelectField.tsx src/components/DerivedSummary.tsx && git commit -m "feat(ui): 基本情報を縦積みに戻す BasicInfoFields"
```

---

### Task 3: `Simulator` を2カラムに組み替え、バーを削除する

**Files:**
- Modify: `src/components/Simulator.tsx`
- Modify: `src/components/DepletionVerdict.tsx`（本文2箇所の文言）
- Modify: `src/components/Simulator.test.tsx`
- Delete: `src/components/BasicInfoBar.tsx`
- Delete: `src/components/BasicInfoBar.test.tsx`
- Delete: `src/components/BarField.tsx`
- Delete: `src/components/BarField.test.tsx`

**Interfaces:**
- Consumes: `InputWarnings`（Task 1）、`BasicInfoFields`（Task 2）

- [ ] **Step 1: 祖先の `overflow` を監査する**

```bash
grep -rn "overflow" src/app/layout.tsx src/app/page.tsx src/app/globals.css
```

Expected: **一致なし。** 一致があれば `position: sticky` が黙って効かなくなるので、先に取り除くこと。

- [ ] **Step 2: 「上のバー」という文言を「左のフォーム」に戻す**

`src/components/DepletionVerdict.tsx` の本文2箇所を置換する。バーが無くなるので、
名指しの先が画面から消える。**狭い画面には左のフォームも無い**ので、両方の場合を1文に含める。

- `"…支出の優先順位を見直す。上のバーを変えてその場で試せます。"`
  → `"…支出の優先順位を見直す。左のフォーム（狭い画面では「入力する」ボタン）を変えてその場で試せます。"`
- `"…「強い計画」と言い切るにはまだ早く、上のバーを変えて一時的な不足を解消できないか試してみてください。"`
  → `"…「強い計画」と言い切るにはまだ早く、左のフォーム（狭い画面では「入力する」ボタン）を変えて一時的な不足を解消できないか試してみてください。"`

- [ ] **Step 3: `Simulator.tsx` の JSX を組み替える**

import から `BasicInfoBar` を外し、`BasicInfoFields` と `InputWarnings` を足す。
`DerivedSummary` の import は**外す**（`BasicInfoFields` の中で使われるようになったため）。
`return` の中身を次にする。**`useState` / `useEffect` / `useMemo` / `skipFirstSave` は一切変えない。**

```tsx
  return (
    <>
      <HearingModal
        sheet={sheet}
        onChange={setSheet}
        open={modalOpen}
        onClose={() => {
          // モーダルを閉じた時点で明示的に保存する。既定値のまま1項目も
          // 変えずに完走した場合、sheet が一度も変化せず保存エフェクトが
          // 発火しないため、これが無いと再読み込みでモーダルが再び開いてしまう
          // （最終レビュー指摘 M-3）
          saveSheet(sheet);
          setModalOpen(false);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/*
          左カラム: 入力フォーム。固定せず、普通に縦スクロールする。
          ⚠️ 狭い画面（1024px未満）では描画しない。そこでの入力は
          固定領域の「入力する」ボタンからポップアップで行う（設計書 §3.2）。
          768px で2カラムにするとグラフが約340pxまで潰れて資産カーブが読めないため、
          区切りは lg（1024px）にしてある
        */}
        <div className="hidden flex-col gap-6 lg:flex">
          <BasicInfoFields sheet={sheet} onChange={setSheet} />
          <OptionalDetailsForm sheet={sheet} onChange={setSheet} />
        </div>

        <div className="flex flex-col gap-6">
          {/*
            右カラムの上部を画面に固定する。
            ⚠️ 背景を不透明にすること。透明だと下からスクロールしてきた文字が
            透けて重なる。z-40 はポップアップ（z-50）より下、他より上。
            ⚠️ この要素より上（layout.tsx / page.tsx）に overflow を足さないこと。
            祖先に overflow があると sticky はエラーも出さずに効かなくなる。
            「モーダル表示中は背景スクロールを止めたい」という理由で document.body に
            実行時に overflow: hidden を付ける実装を足すのも同じく sticky を黙って殺す
            （body も祖先である以上、CSS で足すか JS で足すかは関係ない）。
            狭い画面では -mx-4/px-4 で背景を画面の端まで伸ばすが、
            広い画面ではカラムの内側に収める
          */}
          <div className="sticky top-0 z-40 -mx-4 flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:mx-0 lg:border-0 lg:px-0">
            {/*
              狭い画面にだけ出す。広い画面は左カラムに入力欄が見えているので
              ボタンは重複になる（開き直したい人には下の「入力をやり直す」がある）
            */}
            <button
              type="button"
              className="self-start rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 lg:hidden"
              onClick={() => setModalOpen(true)}
            >
              入力する
            </button>
            <InputWarnings sheet={sheet} />
            <VerdictSummary result={result} />
            <CashflowChart result={result} />
          </div>

          <DepletionVerdict result={result} sheet={sheet} />

          {/*
            ⚠️ ここを左カラムに入れないこと。狭い画面で左カラムごと消えて
            保存したプランに触れなくなる（設計書 §6.3）
          */}
          <div className="flex flex-col gap-4">
            <button
              type="button"
              className="self-start text-xs text-slate-600 underline hover:text-slate-900"
              onClick={() => setModalOpen(true)}
            >
              入力をやり直す
            </button>
            <button
              type="button"
              className="self-start text-xs text-slate-500 underline hover:text-slate-800"
              onClick={() => {
                // clearSheet() は呼ばない。sheet を変えれば保存エフェクトが
                // 追随して DEFAULT_SHEET を localStorage に書き込むため、
                // ここで先に消しても直後の保存エフェクトに上書きされて意味がなかった
                setSheet(DEFAULT_SHEET);
              }}
            >
              入力内容を消して初期値に戻す
            </button>
            {/* ログインしている人にだけ出る。未ログインなら何も描画しない */}
            <SavedPlans sheet={sheet} onLoad={setSheet} />
          </div>

          <p className="text-xs text-slate-500">
            <strong>金額はすべて今日の購買力に換算しています。</strong>
            将来の物価上昇分を差し引いた「実質」の値です。
            楽観＝実質利回り5%・実質昇給+1% ／ 普通＝3%・0% ／ 悲観＝1%・-1%。
            退職金は名目で受け取る前提のため、インフレ（楽観1%・普通2%・悲観3%）で目減りさせて表示しています。
            95歳までを試算しています。
            この結果は特定の金融商品を推奨するものではありません。
          </p>
        </div>
      </div>
    </>
  );
```

- [ ] **Step 4: バーを削除する**

```bash
git rm src/components/BasicInfoBar.tsx src/components/BasicInfoBar.test.tsx src/components/BarField.tsx src/components/BarField.test.tsx
```

- [ ] **Step 5: 参照が残っていないことを確認する**

```bash
grep -rn "BasicInfoBar\|BarField" src/
```

Expected: **一致なし。** 一致したら、その参照を消してから次へ進む。

- [ ] **Step 6: `Simulator.test.tsx` を新しい構造に合わせる**

既存の「任意項目はバーではなくスクロール領域にある」テスト（`.sticky` を使っているもの）を、
次で**置き換える**。バーが無くなったので「バーの中に無い」ではなく
「**固定領域に入力欄が無い**」を検証する形になる。

```tsx
  it("入力欄は固定領域の外にある（固定領域はグラフと判定のためのもの）", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    const fixedArea = document.querySelector(".sticky") as HTMLElement;
    expect(fixedArea).not.toBeNull();
    // 入力欄は左カラム側にある。固定領域の中には無い
    expect(within(fixedArea).queryByLabelText("現在の年齢")).not.toBeInTheDocument();
    expect(within(fixedArea).queryByLabelText("退職金")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("現在の年齢")).toBeInTheDocument();
    expect(screen.getByLabelText("退職金")).toBeInTheDocument();
  });

  it("警告行は固定領域の中にある（狭い画面で左カラムが消えても見えるように）", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    const fixedArea = document.querySelector(".sticky") as HTMLElement;
    expect(within(fixedArea).getByRole("status")).toBeInTheDocument();
  });

  it("「入力する」ボタンでポップアップが開く", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "入力する" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
```

**⚠️ jsdom はメディアクエリを評価しないので、`lg:hidden` / `hidden lg:flex` は効かない。**
上のテストは「DOM に在るか」だけを見ている。画面幅による出し分けは本番で目視する（Task 4）。

- [ ] **Step 7: テスト全体を実行する**

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 8: 型と lint を通す**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし（lint の警告2件は自動生成の `worker/worker-configuration.d.ts` の既存のもので、今回とは無関係）

- [ ] **Step 9: ビルドが通ることを確認する**

Run: `npm run build`
Expected: 成功（静的エクスポートが `out/` に出る）

- [ ] **Step 10: コミットする**

```bash
git add -A src/components && git commit -m "feat(ui): 左フォーム・右グラフ固定の2カラムに組み替え、横スクロールバーを削除"
```

---

### Task 4: 本番デプロイと目視確認

**Files:** なし（デプロイと確認のみ）

**なぜテストで済ませないのか:** **`position: sticky` と、画面幅による出し分け（`hidden lg:flex` / `lg:hidden`）は jsdom では検証できない。** jsdom はメディアクエリを評価せず、レイアウトも計算しない。CSSクラスの有無を見るテストは実装の写経になるだけなので書かない。

2026-08-13 の設計 §13 で本番の18項目を実測した前例に倣う。

- [ ] **Step 1: デプロイする**

```bash
npm run deploy
```

- [ ] **Step 2: デプロイ直後の異常応答は、原因を探る前に1分待って再試行する**

404 / 500 / 429 が出ても、まず待つ。**過去に計3回起きている** Workers の伝播待ちである。

- [ ] **Step 3: 表を埋める**

| 対象 | 期待 | 実測 |
| --- | --- | --- |
| 1024px 以上でページをスクロール | 左カラムが流れ、右のグラフは残る | |
| 1024px 以上のグラフの幅 | 資産カーブが読める幅がある | |
| 1024px 未満 | 左カラムが出ない | |
| 1024px 未満 | 「入力する」ボタンが出る | |
| 「入力する」を押す | ポップアップが開く | |
| 1024px 以上 | 「入力する」ボタンが出ない | |
| リタイア年齢を現在の年齢より前にする | 警告行が右の固定領域に出る | |
| 同上・狭い画面 | 左カラムが無くても警告が見える | |
| 固定領域の高さ | 画面高を超えない（広い画面・狭い画面とも） | |
| ページ本体の横スクロール | 起きない | |
| 判定の本文 | 「左のフォーム（狭い画面では「入力する」ボタン）」になっている | |
| 年間収支 | 年額と月額が出る（バッジは無い） | |

**⚠️ 計測でページを操作したあとの値を、初期状態の値として読まないこと。**
前回、確認スクリプトが内側のスクローラを動かした結果を「ページ本体が横スクロールする」と
誤読した。読み込み直後に測ること。

- [ ] **Step 4: 結果を設計書に追記してコミットする**

`docs/superpowers/specs/2026-08-14-two-column-fixed-chart-design.md` の末尾に
「## 11. 実装後の記録（YYYY-MM-DD）」を足し、上の表の実測と、意図的にやらなかったことを書く。

```bash
git add docs/superpowers/specs/2026-08-14-two-column-fixed-chart-design.md && git commit -m "docs: 左フォーム・右グラフ固定の2カラムの実装後の記録"
```

---

## Self-Review

**1. 設計書の網羅性**

| 設計書の節 | 実装するタスク |
|---|---|
| §2 `BasicInfoBar` / `BarField` の削除 | Task 3 Step 4・5 |
| §3.1 広い画面の2カラム | Task 3 Step 3 |
| §3.2 狭い画面はグラフのみ＋ボタン | Task 3 Step 3 |
| §3.3 区切りは 1024px | Task 3 Step 3（`lg:`） |
| §3.4 固定領域の不透明な背景 | Task 3 Step 3 |
| §4 警告行を右の固定領域に | Task 1・Task 3 Step 3 |
| §5 判定カードは全部固定しない | Task 3 Step 3（固定するのは `VerdictSummary` まで） |
| §6 コンポーネントの増減 | Task 1・2・3 |
| §6.1 `BasicInfoFields` の中身とヒント文 | Task 2 Step 3 |
| §6.2 「入力する」ボタン | Task 3 Step 3 |
| §6.3 やり直す・保存プランの置き場所 | Task 3 Step 3 |
| §7 「左のフォーム」への文言戻し | Task 3 Step 2 |
| §8.1 新しく担保する5点 | Task 1・2・3 |
| §8.2 削除するテスト | Task 3 Step 4 |
| §8.3 本番で目視 | Task 4 |
| §10 未確定事項（左カラム幅・固定領域の高さ） | Task 4 で実測 |

**2. プレースホルダ:** 無し。全ステップに実際のコードか実行するコマンドが入っている。

**3. 型の一貫性:** `InputWarnings({ sheet })` は Task 1 の定義と Task 3 の `<InputWarnings sheet={sheet} />` で一致。`BasicInfoFields({ sheet, onChange })` は Task 2 の定義と Task 3 の呼び出しで一致。`SelectField` に足す `invalid?: boolean` は Task 2 Step 4 で定義し、同 Step 3 の `BasicInfoFields` から渡す。

**設計書に対して2点補った:**

1. **`SelectField` に `invalid` を足す**（Task 2 Step 4）。設計書 §4 は「該当する入力欄の枠を琥珀色にし `aria-invalid` を立てる」と要求しているが、`SelectField` は現在その口を持たない。`BarField` にはあったが削除するため、`SelectField` 側に移す必要がある。既存の呼び出し側は `invalid` を渡さなければ従来どおりの見た目になる
2. **`DerivedSummary` の置き場所**を `BasicInfoFields` の内側と確定した（設計書 §6.1 の記述に沿う）。`Simulator` から直接描画するのはやめる。同じ部品が2か所から描かれるのを避けるため
