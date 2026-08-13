# 結果画面の固定レイアウト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基本情報を横スクロールする1本のバーにして資産グラフとともに画面へ固定し、ヒアリングのポップアップを毎回開くようにする。

**Architecture:** 表示層だけの変更。`Simulator` が持つ `sheet` の流れは変えない。左右2カラムを廃して1カラムにし、「バー＋警告＋判定サマリ＋グラフ」を `position: sticky` の1ブロックにまとめ、残りをその下でスクロールさせる。基本情報の入力は新しい `BasicInfoBar` へ移し、既存の `HearingForm` は任意項目だけの `OptionalDetailsForm` になる。

**Tech Stack:** Next.js 16（静的エクスポート）/ React 19 / Tailwind CSS v4 / Vitest 4 + @testing-library/react / recharts

**設計書:** [docs/superpowers/specs/2026-08-13-pinned-result-layout-design.md](../specs/2026-08-13-pinned-result-layout-design.md)

## Global Constraints

- **計算エンジン（`src/lib/lifeplan/`）・保存スキーマ（`src/lib/storage.ts`）・`worker/` を変更しない。** 表示層だけの変更である
- **コメントは日本語で、「なぜそうしているか」を書く。** 既存ファイルの書き方に合わせる
- **バーに載せる項目は8つで固定。** 横並びツールバーは6〜8種類が限界（Baymard の実測）。任意項目をバーへ足さない
- **あふれた項目を「もっと見る」ボタンに隠さない。** 実測で被験者が丸ごと見落とした
- **矢印でページ送りする Carousel にしない**
- **固定領域の祖先に `overflow: hidden / auto / scroll` を足さない。** sticky がエラーも出さずに効かなくなる
- **`role="banner"` を使わない。** これはサイトヘッダのランドマークであって告知バーの role ではない
- **プレースホルダをラベルの代用にしない**
- DOM 環境が要るテストファイルは先頭に `// @vitest-environment jsdom` を書く（`vitest.config.mts` の既定は node）
- テストは `npm test`、型は `npm run typecheck`、lint は `npm run lint`

---

### Task 1: `BarField`（バー用のコンパクトなセレクト）

**Files:**
- Create: `src/components/BarField.tsx`
- Test: `src/components/BarField.test.tsx`

**Interfaces:**
- Consumes: `withCurrent` from `@/lib/options`
- Produces:
  ```ts
  export function BarField(props: {
    label: string;
    value: number;
    options: number[];
    onChange: (v: number) => void;
    /** 選択肢の表示文字列。省略時は数値をそのまま出す */
    format?: (v: number) => string;
    /** 真なら枠を琥珀色にし aria-invalid を立てる */
    invalid?: boolean;
  }): React.JSX.Element
  ```

**なぜ `SelectField` に `compact` を足さないのか:** 1つの部品が2つのレイアウトを分岐で抱えることになる。`SelectField` はヒント付きの縦積み用としてポップアップと任意項目で使い続ける。

**なぜ `suffix` を持たないのか:** `SelectField` は「歳」をセレクトの外に出しているが、バーでは横幅が最も希少な資源なので、`format` で選択肢の文字列に畳み込む（`(v) => \`${v}歳\``）。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/BarField.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// ラベルとセレクトの結び付き・現在値の表示を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BarField } from "./BarField";

afterEach(() => {
  cleanup();
});

describe("BarField", () => {
  it("ラベルとセレクトが結び付いている", () => {
    render(
      <BarField label="現在の年齢" value={40} options={[39, 40, 41]} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("現在の年齢")).toHaveValue("40");
  });

  it("format を通した文字列が選択肢に出る", () => {
    render(
      <BarField
        label="現在の年齢"
        value={40}
        options={[39, 40]}
        onChange={() => {}}
        format={(v) => `${v}歳`}
      />,
    );
    expect(screen.getByRole("option", { name: "40歳" })).toBeInTheDocument();
  });

  it("選択すると数値で onChange が呼ばれる", () => {
    let latest = 0;
    render(
      <BarField
        label="現在の年齢"
        value={40}
        options={[39, 40, 41]}
        onChange={(v) => (latest = v)}
      />,
    );
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "41" } });
    expect(latest).toBe(41);
  });

  it("選択肢に無い現在値でも表示と実値が一致する（withCurrent）", () => {
    // 旧フォームは自由入力だったので、既存ユーザーの localStorage には
    // 刻みに乗らない値が入っている。差し込まないと画面と sheet が食い違う
    render(
      <BarField label="世帯手取り年収" value={6_123_456} options={[6_000_000, 7_000_000]} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("世帯手取り年収")).toHaveValue("6123456");
  });

  it("invalid のとき aria-invalid が立つ", () => {
    render(
      <BarField label="リタイア予定年齢" value={50} options={[50]} onChange={() => {}} invalid />,
    );
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("invalid でないとき aria-invalid は付かない", () => {
    render(<BarField label="リタイア予定年齢" value={50} options={[50]} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).not.toHaveAttribute("aria-invalid");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/BarField.test.tsx`
Expected: FAIL（`Failed to resolve import "./BarField"`）

- [ ] **Step 3: 実装する**

`src/components/BarField.tsx`:

```tsx
"use client";

import { useId } from "react";
import { withCurrent } from "@/lib/options";

/**
 * 基本情報バー専用の、幅の狭いラベル付きセレクト。
 *
 * `SelectField` と分けているのは、あちらがヒント文つきの縦積み用だから。
 * 1つの部品に compact フラグを足すと、2つのレイアウトを分岐で抱えることになる。
 *
 * ⚠️ `suffix` を持たない。バーでは横幅が最も希少な資源なので、
 * 「歳」などの単位は format で選択肢の文字列に畳み込む
 */
export function BarField({
  label,
  value,
  options,
  onChange,
  format,
  invalid,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** 真なら枠を琥珀色にする。文言はバーの下の警告行が持つ */
  invalid?: boolean;
}) {
  const id = useId();
  // ⚠️ withCurrent はここで適用する。呼び出し側に任せると、1か所忘れただけで
  // 「画面の表示と sheet の値が食い違う」状態になる（src/lib/options.ts 参照）
  const opts = withCurrent(options, value);

  return (
    <div className="flex shrink-0 snap-start flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={id}
        // 枠の色だけでは色覚特性によって伝わらない。支援技術にも同じことを伝える
        aria-invalid={invalid ? true : undefined}
        className={`w-36 rounded border px-2 py-1.5 text-sm tabular-nums focus:outline-none ${
          invalid
            ? "border-amber-500 bg-amber-50 focus:border-amber-600"
            : "border-slate-300 bg-white focus:border-slate-500"
        }`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {format ? format(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- src/components/BarField.test.tsx`
Expected: PASS（6件）

- [ ] **Step 5: コミットする**

```bash
git add src/components/BarField.tsx src/components/BarField.test.tsx && git commit -m "feat(ui): バー用のコンパクトなセレクト BarField"
```

---

### Task 2: `BasicInfoBar`（横スクロールするバーと警告行）

**Files:**
- Create: `src/components/BasicInfoBar.tsx`
- Test: `src/components/BasicInfoBar.test.tsx`

**Interfaces:**
- Consumes: `BarField`（Task 1）、`formatCompactYen` from `@/lib/format`、`isRetirementAgeInvalid` / `isPensionStartAgeInvalid` from `@/lib/lifeplan/guards`、各種選択肢 from `@/lib/options`
- Produces:
  ```ts
  export function BasicInfoBar(props: {
    sheet: HearingSheet;
    onChange: (sheet: HearingSheet) => void;
  }): React.JSX.Element
  ```

**載せる8項目（この順序で）:** 現在の年齢 / 職業 / 世帯手取り年収 / 年間の基本生活費 / 現在の貯金 / 現在の投資額 / リタイア予定年齢 / 年間収支（非対話のバッジ）

**職業だけ `BarField` を使わない。** 値が数値ではなく `Occupation` なので、同じ見た目のセレクトをこのファイル内に直接書く。

**年金の受給開始年齢の警告もここに出す。** 項目そのものは任意項目としてスクロール領域に置くが、警告だけは固定領域に出す。試算が黙って間違っている状態を、スクロールしないと気づけない場所に置いてはいけない。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/BasicInfoBar.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// 警告行の出し分けと8項目の描画を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { BasicInfoBar } from "./BasicInfoBar";

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

describe("BasicInfoBar の項目", () => {
  it("基本情報の7項目が並ぶ", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
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

  it("年間収支は「手取り年収 − 生活費」で出る", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    // 600万 − 360万 = 240万
    expect(screen.getByText("240万円")).toBeInTheDocument();
  });

  it("年間収支は入力欄ではない（非対話のバッジ）", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    expect(screen.queryByLabelText("年間収支")).not.toBeInTheDocument();
  });

  it("項目を変えるとシート全体を返す", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoBar sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
    // 他の項目が落ちていないこと
    expect(latest.retirementAge).toBe(65);
  });

  it("職業を変えられる", () => {
    let latest: HearingSheet = BASE;
    render(<BasicInfoBar sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("職業"), { target: { value: "self_employed" } });
    expect(latest.occupation).toBe("self_employed");
  });
});

describe("BasicInfoBar の警告行", () => {
  it("入力が妥当なら警告行は無い", () => {
    render(<BasicInfoBar sheet={BASE} onChange={() => {}} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("リタイア年齢が現在年齢を下回ると role=status の警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/給与収入が全期間0円/);
  });

  it("リタイア年齢が不正なとき、その項目に aria-invalid が立つ", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 66, retirementAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByLabelText("リタイア予定年齢")).toHaveAttribute("aria-invalid", "true");
  });

  it("年金の受給開始年齢が不正なときも、警告はこのバーに出る", () => {
    // 項目そのものは任意項目としてスクロール領域にあるが、
    // 「黙って間違っている」ことはスクロールせずに気づける場所に出す
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/年金の受給開始年齢/);
  });

  it("2つとも不正なら両方の文言が1つの status に出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, retirementAge: 65, pensionStartAge: 65 };
    render(<BasicInfoBar sheet={sheet} onChange={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/給与収入が全期間0円/);
    expect(status).toHaveTextContent(/年金の受給開始年齢/);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/BasicInfoBar.test.tsx`
Expected: FAIL（`Failed to resolve import "./BasicInfoBar"`）

- [ ] **Step 3: 実装する**

`src/components/BasicInfoBar.tsx`:

```tsx
"use client";

import { useId } from "react";
import { formatCompactYen } from "@/lib/format";
import { isPensionStartAgeInvalid, isRetirementAgeInvalid } from "@/lib/lifeplan/guards";
import type { HearingSheet, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  LIVING_COST_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { BarField } from "./BarField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/** 年齢の選択肢を「40歳」の形にする。バーでは単位をセレクトの外に出す余裕が無い */
const asAge = (v: number) => `${v}歳`;

/**
 * 基本情報の横スクロールバー。画面に固定される領域の一番上に置く。
 *
 * ⚠️ 載せるのは8項目まで。横並びのツールバーは6〜8種類を超えると収まらなくなり、
 * あふれた分を「すべて見る」ボタンに隠すと利用者は丸ごと見落とす（Baymard の実測）。
 * 任意項目（子供・大きな支出・退職金・年金）は OptionalDetailsForm に置く。
 *
 * ⚠️ ヒント文（「配偶者がいれば合算した額」など）はここに出さない。バーの高さが倍になる。
 * ポップアップを毎回開くようにしたので、全員が少なくとも一度は目にする
 * （設計書 §5.1。片方だけを実装してはいけない）
 */
export function BasicInfoBar({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  const occupationId = useId();

  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const retirementInvalid = isRetirementAgeInvalid(sheet);
  const pensionInvalid = isPensionStartAgeInvalid(sheet);

  // 年間収支は入力ではなく導出値。押せるものと押せないものが並ぶので、
  // セレクトと同じ見た目にはしない
  const annualBalance = sheet.householdNetIncome - sheet.annualLivingCost;
  const balanceNegative = annualBalance < 0;

  return (
    <div>
      <div className="relative">
        {/*
          ⚠️ overflow-x を指定すると CSS の規定で overflow-y も auto に計算され、
          このバー自体が縦のスクロールコンテナになる。フォーカスリングが上下で
          切れないよう py で逃がしている。
          scroll-padding-inline は、キーボードで項目を移したときに
          右端のフェードの下へ項目が隠れないようにするためのもの
        */}
        <div className="flex snap-x snap-proximity gap-3 overflow-x-auto px-1 py-2 [scroll-padding-inline:2.5rem]">
          <BarField
            label="現在の年齢"
            value={sheet.currentAge}
            options={CURRENT_AGE_OPTIONS}
            onChange={(v) => set("currentAge", v)}
            format={asAge}
          />

          {/* 職業だけ値が数値ではないので BarField を使えない。見た目は揃える */}
          <div className="flex shrink-0 snap-start flex-col gap-1">
            <label htmlFor={occupationId} className="text-xs font-medium text-slate-600">
              職業
            </label>
            <select
              id={occupationId}
              className="w-36 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
              value={sheet.occupation}
              onChange={(e) => set("occupation", e.target.value as Occupation)}
            >
              {(Object.keys(OCCUPATION_LABELS) as Occupation[]).map((key) => (
                <option key={key} value={key}>
                  {OCCUPATION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <BarField
            label="世帯手取り年収"
            value={sheet.householdNetIncome}
            options={INCOME_OPTIONS}
            onChange={(v) => set("householdNetIncome", v)}
            format={formatCompactYen}
          />
          <BarField
            label="年間の基本生活費"
            value={sheet.annualLivingCost}
            options={LIVING_COST_OPTIONS}
            onChange={(v) => set("annualLivingCost", v)}
            format={formatCompactYen}
          />
          <BarField
            label="現在の貯金"
            value={sheet.savings}
            options={ASSET_OPTIONS}
            onChange={(v) => set("savings", v)}
            format={formatCompactYen}
          />
          <BarField
            label="現在の投資額"
            value={sheet.investments}
            options={ASSET_OPTIONS}
            onChange={(v) => set("investments", v)}
            format={formatCompactYen}
          />
          <BarField
            label="リタイア予定年齢"
            value={sheet.retirementAge}
            options={RETIREMENT_AGE_OPTIONS}
            onChange={(v) => set("retirementAge", v)}
            format={asAge}
            invalid={retirementInvalid}
          />

          <div className="flex shrink-0 snap-start flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">年間収支</span>
            <span
              className={`inline-flex w-36 items-center rounded border px-2 py-1.5 text-sm font-bold tabular-nums ${
                balanceNegative
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-slate-200 bg-slate-100 text-slate-900"
              }`}
            >
              {formatCompactYen(annualBalance)}
            </span>
          </div>
        </div>

        {/*
          続きがあることを示すフェード。
          ⚠️ 矢印でのページ送りは付けない。それは Carousel であって別の部品になる
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-slate-50"
        />
      </div>

      {(retirementInvalid || pensionInvalid) && (
        // ⚠️ role="alert" は使わない。値を変えるたびに読み上げが割り込む。
        // 助言は role="status"。role="banner" はサイトヘッダのランドマークなので論外
        <div
          role="status"
          className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
        >
          {retirementInvalid && (
            <p>
              ⚠️ リタイア予定年齢が現在の年齢より前になっています。この状態では
              給与収入が全期間0円として試算されます
            </p>
          )}
          {pensionInvalid && (
            <p>⚠️ 年金の受給開始年齢が現在の年齢より前になっています</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- src/components/BasicInfoBar.test.tsx`
Expected: PASS（10件）

- [ ] **Step 5: コミットする**

```bash
git add src/components/BasicInfoBar.tsx src/components/BasicInfoBar.test.tsx && git commit -m "feat(ui): 基本情報の横スクロールバーと警告行"
```

---

### Task 3: `verdictHeadline` と `VerdictSummary`（固定領域の判定1行）

**Files:**
- Create: `src/lib/lifeplan/verdict.ts`
- Create: `src/lib/lifeplan/verdict.test.ts`
- Create: `src/components/VerdictSummary.tsx`
- Create: `src/components/VerdictSummary.test.tsx`
- Modify: `src/components/DepletionVerdict.tsx`（見出しの分岐を `verdictHeadline` に置き換える）

**Interfaces:**
- Consumes: `LifeplanResult` from `@/lib/lifeplan/types`
- Produces:
  ```ts
  // src/lib/lifeplan/verdict.ts
  export function verdictHeadline(result: LifeplanResult): string;

  // src/components/VerdictSummary.tsx
  export function VerdictSummary(props: { result: LifeplanResult }): React.JSX.Element;
  ```

**なぜ `verdictHeadline` を切り出すのか:** 見出しの3分岐（尽きない / 尽きる / 一時的に資金不足）を `DepletionVerdict` と `VerdictSummary` の両方が持つと、片方だけ直して他方に反映し忘れる。同じ事故を防ぐために `guards.ts` が作られた前例がある（最終レビュー指摘 C1）。

- [ ] **Step 1: `verdictHeadline` の失敗するテストを書く**

`src/lib/lifeplan/verdict.test.ts`（jsdom 不要）:

```ts
import { describe, expect, it } from "vitest";
import type { LifeplanResult, ScenarioResult } from "./types";
import { verdictHeadline } from "./verdict";

function scenario(over: Partial<ScenarioResult>): ScenarioResult {
  return {
    key: "baseline",
    label: "普通",
    rows: [],
    depletionAge: null,
    temporaryShortfall: false,
    finalTotal: 0,
    ...over,
  };
}

describe("verdictHeadline", () => {
  it("すべてのシナリオで尽きなければ「尽きません」", () => {
    const result: LifeplanResult = { scenarios: [scenario({})], survivesAllScenarios: true };
    expect(verdictHeadline(result)).toBe("悲観シナリオでも資産は尽きません");
  });

  it("尽きるシナリオがあれば「尽きるシナリオがあります」", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ depletionAge: 83 })],
      survivesAllScenarios: false,
    };
    expect(verdictHeadline(result)).toBe("資産が尽きるシナリオがあります");
  });

  it("尽きはしないが一時的に不足するなら、その旨の見出し", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ temporaryShortfall: true })],
      survivesAllScenarios: false,
    };
    expect(verdictHeadline(result)).toBe(
      "尽きはしませんが、一時的に資金不足になるシナリオがあります",
    );
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/lib/lifeplan/verdict.test.ts`
Expected: FAIL（`Failed to resolve import "./verdict"`）

- [ ] **Step 3: `verdictHeadline` を実装する**

`src/lib/lifeplan/verdict.ts`:

```ts
import type { LifeplanResult } from "./types";

/**
 * 判定の見出し。
 *
 * ⚠️ 分岐をここに集約する。固定領域の VerdictSummary と、スクロール領域の
 * DepletionVerdict が同じ判定を別々に書くと、片方だけ直して他方に
 * 反映し忘れる。guards.ts が作られたのと同じ理由（最終レビュー指摘 C1）。
 *
 * survivesAllScenarios は「尽きない」かつ「一時的な資金不足もない」を要求するので、
 * false になる理由は2通りある。実際に尽きるのか、尽きはしないが途中で
 * マイナスへ落ちるのかで文言を変える
 */
export function verdictHeadline(result: LifeplanResult): string {
  if (result.survivesAllScenarios) return "悲観シナリオでも資産は尽きません";
  const anyDepletes = result.scenarios.some((s) => s.depletionAge !== null);
  return anyDepletes
    ? "資産が尽きるシナリオがあります"
    : "尽きはしませんが、一時的に資金不足になるシナリオがあります";
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- src/lib/lifeplan/verdict.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: `VerdictSummary` の失敗するテストを書く**

`src/components/VerdictSummary.test.tsx`:

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LifeplanResult, ScenarioResult } from "@/lib/lifeplan/types";
import { VerdictSummary } from "./VerdictSummary";

afterEach(() => {
  cleanup();
});

function scenario(over: Partial<ScenarioResult>): ScenarioResult {
  return {
    key: "baseline",
    label: "普通",
    rows: [],
    depletionAge: null,
    temporaryShortfall: false,
    finalTotal: 0,
    ...over,
  };
}

describe("VerdictSummary", () => {
  it("見出しを出す", () => {
    const result: LifeplanResult = {
      scenarios: [scenario({ depletionAge: 83 })],
      survivesAllScenarios: false,
    };
    render(<VerdictSummary result={result} />);
    expect(screen.getByText("資産が尽きるシナリオがあります")).toBeInTheDocument();
  });

  it("シナリオごとに「ラベル + 結末」を1つずつ出す", () => {
    const result: LifeplanResult = {
      scenarios: [
        scenario({ key: "optimistic", label: "楽観" }),
        scenario({ key: "baseline", label: "普通", depletionAge: 83 }),
        scenario({ key: "pessimistic", label: "悲観", temporaryShortfall: true }),
      ],
      survivesAllScenarios: false,
    };
    render(<VerdictSummary result={result} />);
    expect(screen.getByText("楽観 尽きない")).toBeInTheDocument();
    expect(screen.getByText("普通 83歳で尽きる")).toBeInTheDocument();
    expect(screen.getByText("悲観 一時的に不足")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npm test -- src/components/VerdictSummary.test.tsx`
Expected: FAIL（`Failed to resolve import "./VerdictSummary"`）

- [ ] **Step 7: `VerdictSummary` を実装する**

`src/components/VerdictSummary.tsx`:

```tsx
"use client";

import type { LifeplanResult } from "@/lib/lifeplan/types";
import { verdictHeadline } from "@/lib/lifeplan/verdict";

/** 1シナリオの結末を短く言い切る。固定領域に置くので1行に収める */
function outcome(s: LifeplanResult["scenarios"][number]): string {
  if (s.depletionAge !== null) return `${s.depletionAge}歳で尽きる`;
  if (s.temporaryShortfall) return "一時的に不足";
  return "尽きない";
}

/**
 * 判定を1行に圧縮したもの。画面に固定される領域に置く。
 *
 * ⚠️ 判定カード（DepletionVerdict）を丸ごと固定しないのは、
 * 年金0円の警告＋判定＋3枚のカードで縦300pxあり、グラフ360pxと合わせると
 * 固定領域が画面高を超えるため。画面高を超えた sticky は下端が永久に見えない
 * （設計書 §4.2）。打ち手の本文と95歳時点の残高はスクロール領域へ置く
 */
export function VerdictSummary({ result }: { result: LifeplanResult }) {
  const { survivesAllScenarios } = result;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2 ${
        survivesAllScenarios
          ? "border-emerald-300 bg-emerald-50"
          : "border-amber-300 bg-amber-50"
      }`}
    >
      <span className="text-sm font-bold text-slate-900">{verdictHeadline(result)}</span>
      {result.scenarios.map((s) => (
        <span
          key={s.key}
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600"
        >
          {`${s.label} ${outcome(s)}`}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: テストを実行して通ることを確認する**

Run: `npm test -- src/components/VerdictSummary.test.tsx`
Expected: PASS（2件）

- [ ] **Step 9: `DepletionVerdict` を `verdictHeadline` に寄せる**

`src/components/DepletionVerdict.tsx` の `anyDepletes` の宣言（29行目付近）と、見出しの三項演算子（57〜63行目付近）を次に置き換える。**表示される文字列は1文字も変えない。**

```tsx
// import に追加
import { verdictHeadline } from "@/lib/lifeplan/verdict";

// `const anyDepletes = ...` の行を削除し、見出しを次にする
        <div className="text-lg font-bold text-slate-900">{verdictHeadline(result)}</div>
```

`anyDepletes` は本文（`<p className="mt-1 text-sm text-slate-700">`）の分岐でも使われている。**本文の分岐はそのまま残す**ので、`anyDepletes` の宣言は削除せず残すこと。見出しだけを差し替える。

- [ ] **Step 10: テスト全体を実行して回帰が無いことを確認する**

Run: `npm test`
Expected: PASS（既存の `Simulator.test.tsx` を含めすべて）

- [ ] **Step 11: コミットする**

```bash
git add src/lib/lifeplan/verdict.ts src/lib/lifeplan/verdict.test.ts src/components/VerdictSummary.tsx src/components/VerdictSummary.test.tsx src/components/DepletionVerdict.tsx && git commit -m "feat(ui): 判定1行の VerdictSummary と見出しの共通化"
```

---

### Task 4: `HearingForm` を `OptionalDetailsForm` にする

**Files:**
- Create: `src/components/OptionalDetailsForm.tsx`（`HearingForm.tsx` の内容から基本情報セクションを削ったもの）
- Create: `src/components/OptionalDetailsForm.test.tsx`（`HearingForm.test.tsx` を移したもの）
- Delete: `src/components/HearingForm.tsx`
- Delete: `src/components/HearingForm.test.tsx`
- Modify: `src/components/Simulator.tsx`（import と JSX のタグ名だけ）

**Interfaces:**
- Produces:
  ```ts
  export function OptionalDetailsForm(props: {
    sheet: HearingSheet;
    onChange: (sheet: HearingSheet) => void;
  }): React.JSX.Element
  ```

**なぜ改名するのか:** 基本情報を持たない「HearingForm」は名前と中身が食い違う。読む人が「基本情報はここにあるはず」と探して見つからない。

**この時点ではまだレイアウトを変えない。** `Simulator` はタグ名を差し替えるだけ。レイアウトの組み替えは Task 5 で行う。

- [ ] **Step 1: ファイルを git mv で移す**

```bash
git mv src/components/HearingForm.tsx src/components/OptionalDetailsForm.tsx
git mv src/components/HearingForm.test.tsx src/components/OptionalDetailsForm.test.tsx
```

- [ ] **Step 2: テストを書き換える（基本情報を触るテストを消し、名前を合わせる）**

`src/components/OptionalDetailsForm.test.tsx` で次を行う。

1. `import { HearingForm } from "./HearingForm";` → `import { OptionalDetailsForm } from "./OptionalDetailsForm";`
2. ファイル内の `<HearingForm` をすべて `<OptionalDetailsForm` に置換
3. `describe("HearingForm の行操作")` → `describe("OptionalDetailsForm の行操作")`
4. **基本情報の項目（現在の年齢・職業・世帯手取り年収・年間の基本生活費・現在の貯金・現在の投資額・リタイア予定年齢）と、年間収支の大きなパネルに触れるテストがあれば削除する。** それらは Task 2 の `BasicInfoBar.test.tsx` が担保する

さらに、基本情報が消えたことを固定する1件を追加する:

```tsx
  it("基本情報はここには無い（バーへ移った）", () => {
    render(<OptionalDetailsForm sheet={BASE} onChange={() => {}} />);
    expect(screen.queryByLabelText("現在の年齢")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("世帯手取り年収")).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test -- src/components/OptionalDetailsForm.test.tsx`
Expected: FAIL（追加した1件が「現在の年齢が見つかる」で落ちる。実装がまだ基本情報を描画しているため）

- [ ] **Step 4: `OptionalDetailsForm.tsx` を実装する**

1. 関数名を `HearingForm` → `OptionalDetailsForm` に変更
2. **最初の `<section className="flex flex-col gap-4">`（`<h2>基本情報</h2>` から `<DerivedSummary sheet={sheet} />` までの1ブロック）をまるごと削除する**
3. 残った2つ目の `<section>` から `border-t border-slate-200 pt-6` を外す（先頭に来るので区切り線が浮く）
4. 使わなくなった import を削除する: `DerivedSummary`、`isRetirementAgeInvalid`、`CURRENT_AGE_OPTIONS`、`INCOME_OPTIONS`、`LIVING_COST_OPTIONS`、`ASSET_OPTIONS`、`RETIREMENT_AGE_OPTIONS`、`Occupation` 型、`OCCUPATION_LABELS` 定数、`retirementAgeInvalid` の宣言
5. 先頭のコメントを差し替える:

```tsx
/**
 * 任意項目（Tier 2）の入力フォーム。スクロール領域に置く。
 *
 * 基本情報（Tier 1）は BasicInfoBar へ移した。
 * ⚠️ ここの項目をバーへ移さないこと。子供と大きな支出は行が増減するので
 * 横一列に収まらないうえ、バーの項目数が上限（8）を超える（設計書 §6）
 */
```

- [ ] **Step 5: `Simulator.tsx` のタグ名を差し替える**

`import { HearingForm } from "./HearingForm";` を
`import { OptionalDetailsForm } from "./OptionalDetailsForm";` にし、
`<HearingForm sheet={sheet} onChange={setSheet} />` を
`<OptionalDetailsForm sheet={sheet} onChange={setSheet} />` にする。

- [ ] **Step 6: テストを実行する**

Run: `npm test`
Expected: `OptionalDetailsForm.test.tsx` は PASS。**`Simulator.test.tsx` は落ちてよい**（`現在の年齢` が画面から消えるため）。次の Task 5 で直す

- [ ] **Step 7: `npm run typecheck` を実行して未使用 import が残っていないことを確認する**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: コミットする**

```bash
git add -A src/components && git commit -m "refactor(ui): HearingForm を OptionalDetailsForm にし基本情報を外す"
```

---

### Task 5: `Simulator` を固定レイアウトに組み替える

**Files:**
- Modify: `src/components/Simulator.tsx`
- Modify: `src/components/DerivedSummary.tsx`
- Modify: `src/components/DepletionVerdict.tsx:68-69`（文言）
- Modify: `src/components/CashflowChart.tsx:65`（高さ）
- Modify: `src/components/Simulator.test.tsx`

**Interfaces:**
- Consumes: `BasicInfoBar`（Task 2）、`VerdictSummary`（Task 3）、`OptionalDetailsForm`（Task 4）

- [ ] **Step 1: 祖先の `overflow` を監査する**

```bash
grep -rn "overflow" src/app/layout.tsx src/app/page.tsx src/app/globals.css
```

Expected: **一致なし。** 一致があれば sticky はエラーも出さずに効かなくなるので、先に取り除くこと。
（2026-08-13 時点では `html > body > main > Simulator` に overflow は無いことを確認済み）

- [ ] **Step 2: グラフの高さを画面比で縮むようにする**

`src/components/CashflowChart.tsx:65` の
`className="h-[360px] w-full rounded-lg border border-slate-200 bg-white p-4"` を次にする:

```tsx
      // ⚠️ 固定領域に入るので、画面高を超えないよう vh で縮める。
      // 画面高を超えた sticky は下端が永久に見えなくなる（設計書 §4.2）
      className="h-[min(360px,40vh)] w-full rounded-lg border border-slate-200 bg-white p-4"
```

- [ ] **Step 3: `DerivedSummary` から大きな金額を外す**

年額はバーのバッジが出すので重複する。`src/components/DerivedSummary.tsx` の `return` を次にする（関数の引数と冒頭の計算はそのまま）:

```tsx
  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isNegative ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
      {/*
        年額は基本情報バーのバッジが出すので、ここでは繰り返さない。
        月あたりの額と、実感と照らし合わせるための説明だけを残す
      */}
      <div className="font-medium text-slate-700">
        年間収支は月あたり <span className="tabular-nums font-bold">{formatYen(monthly)}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {isNegative
          ? "支出が収入を上回っています。生活費の入力が実態と合っているか確認してください。"
          : "これは基本生活費だけを差し引いた金額で、教育費やライフイベント費は含みません。実感と大きくずれていれば、生活費の入力を見直してください。"}
      </p>
    </div>
  );
```

`annualBalance` は `monthly` の計算にだけ使われる形になるので、`formatYen(annualBalance)` の呼び出しが消えても `formatYen` の import は残す（`monthly` で使う）。

- [ ] **Step 4: 「左のフォーム」という文言を直す**

`src/components/DepletionVerdict.tsx:68-69` の本文2箇所を置換する。**左カラムを廃止するので、名指しの先が存在しなくなる。**

- `"打ち手は5つです。生活費を下げる / 収入を増やす / 利回り・期間を見直す / 想定外の支出を防ぐ / 支出の優先順位を見直す。左のフォームを変えてその場で試せます。"`
  → 末尾を `上のバーを変えてその場で試せます。` にする
- `"…「強い計画」と言い切るにはまだ早く、左のフォームを変えて一時的な不足を解消できないか試してみてください。"`
  → `左のフォームを` を `上のバーを` にする

- [ ] **Step 5: `Simulator.tsx` の JSX を組み替える**

`import { HearingForm }`／`import { DerivedSummary }` 周辺の import に `BasicInfoBar` と `VerdictSummary` を足し、`return` の中身（78〜138行目）を次にする。**`useState` / `useEffect` / `useMemo` は一切変えない。**

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

      {/*
        画面に固定される領域。バー・警告・判定1行・グラフをここに入れる。
        ⚠️ 背景を不透明にすること。透明だと下からスクロールしてきた文字が
        透けて重なる。z-40 はポップアップ（z-50）より下、他より上
        ⚠️ この要素より上（layout.tsx / page.tsx）に overflow を足さないこと。
        祖先に overflow があると sticky はエラーも出さずに効かなくなる
      */}
      <div className="sticky top-0 z-40 -mx-4 border-b border-slate-200 bg-slate-50 px-4 pb-3">
        <BasicInfoBar sheet={sheet} onChange={setSheet} />
        <div className="mt-2 flex flex-col gap-2">
          <VerdictSummary result={result} />
          <CashflowChart result={result} />
        </div>
      </div>

      {/* ここから下がスクロールする */}
      <div className="flex flex-col gap-6 pt-6">
        <DepletionVerdict result={result} sheet={sheet} />
        <DerivedSummary sheet={sheet} />
        <OptionalDetailsForm sheet={sheet} onChange={setSheet} />
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
    </>
  );
```

`-mx-4 ... px-4` は、固定領域の背景を `page.tsx` の `px-4` の外側まで伸ばして、横から文字が覗かないようにするためのもの。

- [ ] **Step 6: `Simulator.test.tsx` を新しいレイアウトに合わせる**

現在のテストは `findByLabelText(/^現在の年齢/)` で基本情報を取っている。バーへ移っただけなのでセレクタは変わらないが、**モーダルが開いていると同じラベルが2つになる**。既存の各テストがモーダルを閉じているかを確認し、閉じていないものに1行足す。

対象は次の3件（いずれも `render(<Simulator />);` の直後に入れる）:

```tsx
    // モーダルが自動で開くとラベルが二重になるので、先に閉じる
    fireEvent.keyDown(document, { key: "Escape" });
```

- `"localStorageに保存済みのシートがあれば、マウント後にそれを復元してフォームに反映する"`
- `"リセットボタンを押すと既定値に戻り、localStorageも既定値になる（…）"`
- `"「入力をやり直す」でモーダルが開く"` は**閉じてから押す**（`findByText("入力をやり直す")` の前に Escape を入れる）

さらに1件追加する:

```tsx
  it("任意項目はバーではなくスクロール領域にある", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });
    // バーに載せてよいのは8項目まで。子供の追加ボタンはスクロール領域側
    expect(await screen.findByRole("button", { name: "子供を追加" })).toBeInTheDocument();
    expect(screen.queryByLabelText("退職金")).toBeInTheDocument();
  });
```

- [ ] **Step 7: テスト全体を実行する**

Run: `npm test`
Expected: PASS（全ファイル）

- [ ] **Step 8: 型と lint を通す**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 9: コミットする**

```bash
git add -A src/components && git commit -m "feat(ui): 基本情報バーとグラフを画面に固定する1カラムに組み替え"
```

---

### Task 6: `Steps`（押せるステップ表示）

**Files:**
- Create: `src/components/Steps.tsx`
- Test: `src/components/Steps.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function Steps(props: {
    titles: readonly string[];
    /** 0起点の現在位置 */
    current: number;
    onSelect: (index: number) => void;
  }): React.JSX.Element
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/components/Steps.test.tsx`:

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Steps } from "./Steps";

afterEach(() => {
  cleanup();
});

const TITLES = ["あなたのこと", "お金の流れ", "いまの資産"] as const;

describe("Steps", () => {
  it("段の数だけボタンが出る", () => {
    render(<Steps titles={TITLES} current={0} onSelect={() => {}} />);
    for (const t of TITLES) {
      expect(screen.getByRole("button", { name: new RegExp(t) })).toBeInTheDocument();
    }
  });

  it("aria-current=step が付くのはちょうど1つ", () => {
    const { container } = render(<Steps titles={TITLES} current={1} onSelect={() => {}} />);
    // 2つ以上に付けると読み上げ位置が壊れる
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("aria-current=step が付くのは現在の段", () => {
    render(<Steps titles={TITLES} current={1} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /お金の流れ/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("押すとその段の番号を返す", () => {
    let picked = -1;
    render(<Steps titles={TITLES} current={0} onSelect={(i) => (picked = i)} />);
    fireEvent.click(screen.getByRole("button", { name: /いまの資産/ }));
    expect(picked).toBe(2);
  });

  it("完了した段は番号ではなくチェックを出す", () => {
    render(<Steps titles={TITLES} current={2} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /あなたのこと/ })).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: /いまの資産/ })).toHaveTextContent("3");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/Steps.test.tsx`
Expected: FAIL（`Failed to resolve import "./Steps"`）

- [ ] **Step 3: 実装する**

`src/components/Steps.tsx`:

```tsx
"use client";

/**
 * ステップ表示。
 *
 * ⚠️ aria-current="step" は現在の段だけに付ける。2つ以上に付けると
 * 読み上げの位置が壊れる。
 *
 * ⚠️ 状態は current という単一の数値から導出する。完了・現在・未到達を
 * 別々に持つと、片方だけ更新して食い違う。
 *
 * 段を押せるのは、ポップアップを毎回開くようにしたから。
 * 「年収だけ直したい」再訪者に「次へ」を4回押させる設計は成立しない
 */
export function Steps({
  titles,
  current,
  onSelect,
}: {
  titles: readonly string[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {titles.map((title, i) => {
        const done = i < current;
        const isCurrent = i === current;
        return (
          <li key={title} className="flex items-center">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-slate-100 ${
                isCurrent ? "font-bold text-slate-900" : "text-slate-500"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                  done
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isCurrent
                      ? "border-slate-900 text-slate-900"
                      : "border-slate-300 text-slate-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {title}
            </button>
            {i < titles.length - 1 && (
              <span aria-hidden className="h-px w-3 bg-slate-300" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test -- src/components/Steps.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: コミットする**

```bash
git add src/components/Steps.tsx src/components/Steps.test.tsx && git commit -m "feat(ui): 押せるステップ表示 Steps"
```

---

### Task 7: `HearingModal` に Steps・抜け道・フォーカストラップを入れる

**Files:**
- Modify: `src/components/HearingModal.tsx`
- Modify: `src/components/HearingModal.test.tsx`

**Interfaces:**
- Consumes: `Steps`（Task 6）
- Produces: `HearingModal` の props は変えない

**なぜフォーカストラップを今やるのか:** `HearingModal.tsx:80` は「完全なフォーカストラップは今回のスコープ外」と書いている。この判断は「モーダルは初回訪問だけ開く」が前提だった。Task 8 で毎回開くようにすると、モーダルは全利用者の必経路になる。前提が崩れたので先送りできない。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/HearingModal.test.tsx` の `describe("HearingModal")` の末尾に追加する:

```tsx
  it("ステップ表示の段を押すとその段へ飛ぶ", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /老後/ }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("老後");
  });

  it("aria-current=step が付くのはちょうど1つ", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("「この内容で見る」はどのステップにもあり、押すと閉じる", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "この内容で見る" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("最後のステップにも「この内容で見る」がある", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    expect(screen.getByRole("button", { name: "この内容で見る" })).toBeInTheDocument();
  });
});

describe("フォーカスの扱い", () => {
  it("Tab は最後の操作要素から最初へ回り込む", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button, select, input");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab は最初の操作要素から最後へ回り込む", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("button, select, input");
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("閉じるとフォーカスが開く前の要素へ戻る", () => {
    render(<button type="button">呼び出し元</button>);
    const opener = screen.getByRole("button", { name: "呼び出し元" });
    opener.focus();

    const { rerender } = render(
      <HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />,
    );
    rerender(<HearingModal sheet={BASE} onChange={() => {}} open={false} onClose={() => {}} />);

    expect(document.activeElement).toBe(opener);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/HearingModal.test.tsx`
Expected: FAIL（`この内容で見る` が見つからない、Tab が回り込まない、など7件前後）

- [ ] **Step 3: `Steps` を組み込み、「ステップ n / 6」のテキストを置き換える**

`src/components/HearingModal.tsx` の import に `import { Steps } from "./Steps";` を足し、
ヘッダ部（123〜139行目）の `<p className="text-xs text-slate-500">ステップ {step + 1} / {STEP_TITLES.length}</p>` を次に差し替える:

```tsx
            <Steps titles={STEP_TITLES} current={step} onSelect={setStep} />
```

- [ ] **Step 4: フッターに「この内容で見る」を足す**

フッター（404〜434行目）の `<div className="flex gap-2">` の中、`スキップ` の前に置く:

```tsx
            {/*
              毎回開く以上、再訪者が抜ける道が要る。
              ✕ と Escape だけでは「閉じ方が分からない」人が6ステップ押し切ることになる
            */}
            <button
              type="button"
              className="rounded px-3 py-2 text-sm text-slate-600 underline hover:text-slate-900"
              onClick={onClose}
            >
              この内容で見る
            </button>
```

- [ ] **Step 5: フォーカストラップと復帰を実装する**

`useRef` に2つ足し、Escape のエフェクト（87〜94行目）を次で置き換える:

```tsx
  const dialogRef = useRef<HTMLDivElement>(null);
  // 開く直前にフォーカスがあった要素。閉じたらここへ返す
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 開いている間だけ、閉じたときの戻り先を覚えておく。
  // クリーンアップで返すので、閉じ方（✕・Escape・この内容で見る）を問わず1か所で済む
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape で閉じる。加えて Tab をモーダル内で循環させる。
  //
  // ⚠️ モーダルを毎回開くようにしたので、これは全利用者の必経路になった。
  // キーボードだけで操作する人がモーダルの外へ抜けると、背後のバーを
  // 操作できてしまい、どこにいるのか分からなくなる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select, input, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active);

      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
```

`role="dialog"` を持つ `<div>`（117〜122行目）に `ref={dialogRef}` を足す。

80行目付近のコメント「完全なフォーカストラップは今回のスコープ外（最終レビュー指摘 C2）」を削除し、次に置き換える:

```tsx
  // 開いたときにモーダル内の最初の操作要素（✕ボタン）へフォーカスを移す
```

- [ ] **Step 6: テストを実行して通ることを確認する**

Run: `npm test -- src/components/HearingModal.test.tsx`
Expected: PASS（既存分と追加分すべて）

- [ ] **Step 7: コミットする**

```bash
git add src/components/HearingModal.tsx src/components/HearingModal.test.tsx && git commit -m "feat(ui): ポップアップに押せるステップ・抜け道・フォーカストラップ"
```

---

### Task 8: ポップアップを毎回開く

**Files:**
- Modify: `src/components/Simulator.tsx:32-44`
- Modify: `src/components/Simulator.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/Simulator.test.tsx` の `describe("初回訪問のモーダル")` を
`describe("ポップアップ")` に変え、`"保存があればモーダルは開かない"` を次で**置き換える**:

```tsx
  it("保存があってもモーダルは開く（毎回開く）", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 40,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("毎回開くが、保存済みの値は復元されたうえで開く", async () => {
    localStorage.setItem(
      "lifeplan.sheet.v2",
      JSON.stringify({
        currentAge: 52,
        occupation: "employee",
        householdNetIncome: 6_000_000,
        annualLivingCost: 3_600_000,
        savings: 3_000_000,
        investments: 3_000_000,
        retirementAge: 65,
      }),
    );
    render(<Simulator />);
    const dialog = await screen.findByRole("dialog");
    // モーダル側の「現在の年齢」に復元値が入っていること
    expect(within(dialog).getByLabelText("現在の年齢")).toHaveValue("52");
  });
```

`"「入力をやり直す」でモーダルが開く"` は、**開いているものを一度閉じてから押す**形に直す:

```tsx
  it("閉じたあと「入力をやり直す」で開き直せる", async () => {
    localStorage.clear();
    render(<Simulator />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(await screen.findByText("入力をやり直す"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/Simulator.test.tsx`
Expected: FAIL（`"保存があってもモーダルは開く"` が「dialog が見つからない」で落ちる）

- [ ] **Step 3: 実装する**

`src/components/Simulator.tsx` の復元エフェクト（32〜44行目）を次にする:

```tsx
  // localStorage は静的エクスポート時のプリレンダリングでは触れないので、
  // マウント後に読み込んで差し替える。
  // レンダー中に読むと、ビルド時のHTML（既定値）とクライアントの初回描画が
  // 食い違って hydration 不一致になるため、この順序以外に安全な形が無い。
  // react-hooks/set-state-in-effect は「外部ストアとの同期」にあたるこの用途を
  // 弾いてくるので、理由を添えてこの1行だけ無効化する
  useEffect(() => {
    const saved = loadSheet();
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSheet(saved);
    }
    // ⚠️ 保存の有無で分岐しない。利用者の判断（2026-08-13）で毎回開く。
    // 復元と同じエフェクトで開くのは順序のため——別エフェクトにすると
    // 復元前の既定値が一瞬モーダルに映る
    setModalOpen(true);
  }, []);
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS（全ファイル）

`within` を使う場合は `Simulator.test.tsx` の import に含まれていることを確認する（既存の import 行に `within` がある）。

- [ ] **Step 5: 型と lint を通す**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 6: ビルドが通ることを確認する**

Run: `npm run build`
Expected: 成功（静的エクスポートが `out/` に出る）

- [ ] **Step 7: コミットする**

```bash
git add src/components/Simulator.tsx src/components/Simulator.test.tsx && git commit -m "feat(ui): ヒアリングのポップアップを毎回開く"
```

---

### Task 9: 本番での目視確認

**Files:** なし（デプロイと確認のみ）

**なぜテストで済ませないのか:** **固定されているかどうか（sticky）は jsdom では検証できない。** CSSクラスの有無を見るテストは実装の写経になるだけで、実際に固定されるかは分からない。設計書 §11 に前例がある——比較グラフはlint・コードレビューをすべて通過したまま、本番でY軸が-5億円まで伸びていた。

- [ ] **Step 1: デプロイする**

```bash
npm run deploy
```

- [ ] **Step 2: デプロイ直後の異常応答は、原因を探る前に1分待って再試行する**

`/api/*` や新しいページが 404 / 500 / 429 を返しても、まず待つ。
**設計書 §12.3・§12.4・サブプロジェクトE で計3回起きている**、Workers の伝播待ちである。

- [ ] **Step 3: 表を埋める**

| 対象 | 期待 | 実測 |
| --- | --- | --- |
| PC でページを下までスクロール | バーとグラフが画面に残り続ける | |
| スマホでページを下までスクロール | 同上。固定領域が画面を埋めない | |
| スマホでバーを横に払う | 8項目すべてに到達できる | |
| バーの右端 | フェードが出て「続きがある」と分かる | |
| リタイア予定年齢を現在の年齢より前にする | 警告行が固定領域に出る | |
| 年金の受給開始年齢を現在の年齢より前にする | 警告行が固定領域に出る（項目は下にあるのに） | |
| キーボードだけでバーを移動 | 項目が右端のフェードの下に隠れない | |
| ポップアップを開いて Tab を押し続ける | フォーカスがモーダルの外へ出ない | |
| ポップアップを閉じる | フォーカスが呼び出し元へ戻る | |
| 再訪（リロード） | ポップアップが開き、前回の値が入っている | |
| ステップの段を押す | その段へ飛ぶ | |
| 「この内容で見る」 | 即座に閉じて結果が見える | |
| 判定の本文 | 「上のバーを変えて」になっている（「左のフォーム」が残っていない） | |

- [ ] **Step 4: 結果を設計書に追記してコミットする**

`docs/superpowers/specs/2026-08-13-pinned-result-layout-design.md` の末尾に
「## 実装後の記録（YYYY-MM-DD）」を足し、上の表の実測と、意図的にやらなかったことを書く。

```bash
git add docs/superpowers/specs/2026-08-13-pinned-result-layout-design.md && git commit -m "docs: 結果画面の固定レイアウトの実装後の記録"
```

---

## Self-Review

**1. 設計書の網羅性**

| 設計書の節 | 実装するタスク |
|---|---|
| §2.1 2カラム廃止 | Task 5 |
| §2.2 フォーカストラップ | Task 7 |
| §4.1 固定領域とスクロール領域 | Task 5 |
| §4.1 不透明な背景 | Task 5 Step 5 |
| §4.2 グラフの高さ上限 | Task 5 Step 2 |
| §5.1 バーの8項目・ヒント文を出さない | Task 2 |
| §5.2 年間収支をバッジに | Task 2（バッジ）+ Task 5 Step 3（説明文の移動） |
| §5.3 フェード・scroll-snap・scroll-padding | Task 2 |
| §5.4 警告行・`role="status"` | Task 2 |
| §5.5 `overflow-x` の副作用 | Task 2（py で逃がす） |
| §6 任意項目をバーに入れない | Task 4 |
| §7.1 毎回開く | Task 8 |
| §7.2 抜け道2つ | Task 6（Steps）+ Task 7（この内容で見る） |
| §7.3 Steps | Task 6・Task 7 |
| §7.4 フォーカストラップ | Task 7 |
| §8 コンポーネント分割 | Task 1〜7 |
| §9 「左のフォーム」の修正 | Task 5 Step 4 |
| §10.1 新しく担保する8点 | Task 2・5・6・7・8 |
| §10.3 本番で目視 | Task 9 |
| §3 祖先の overflow 監査 | Task 5 Step 1 |

**2. プレースホルダ:** 無し。全ステップに実際のコードか実行するコマンドが入っている。

**3. 型の一貫性:** `BarField` の props（`label` / `value` / `options` / `onChange` / `format` / `invalid`）は Task 1 の定義と Task 2 の呼び出しで一致。`Steps` の props（`titles` / `current` / `onSelect`）は Task 6 の定義と Task 7 の `<Steps titles={STEP_TITLES} current={step} onSelect={setStep} />` で一致（`STEP_TITLES` は `readonly string[]` に代入可能な `as const` 配列）。`verdictHeadline(result: LifeplanResult): string` は Task 3 の定義と `VerdictSummary` / `DepletionVerdict` の呼び出しで一致。

**設計書に対して1点補った:** 設計書 §5.2 は「年間収支の大きなパネルを縮小し、説明文はスクロール領域へ移す」とだけ書いており、年額と月額のどちらがどこへ行くかが一意に読めなかった。**年額はバーのバッジ、月額と説明文は `DerivedSummary`（スクロール領域）** と決めて Task 2 と Task 5 に落とした。重複して同じ金額を2か所に出さないための判断。
