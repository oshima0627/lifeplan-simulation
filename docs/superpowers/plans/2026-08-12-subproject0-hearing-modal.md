# サブプロジェクト0：ヒアリングUIのポップアップ＋プルダウン化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ヒアリング入力をステップ式モーダル＋プルダウンにし、初めての人が迷わず最後まで入力できるようにする。

**Architecture:** 選択肢の生成を純粋関数に切り出し（`src/lib/options.ts`）、それを使う共通部品 `SelectField` を作る。既存の横並び `HearingForm` はこの部品に置き換え、新規の `HearingModal` は同じ部品を6ステップに並べる。モーダルと横フォームは**同じ入力部品を共有**する。

**Tech Stack:** Next.js 16（静的エクスポート）/ React 19 / Tailwind CSS v4 / Vitest 4 + @testing-library/react + jsdom

## Global Constraints

- 設計の正は `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` §4。数値はそこから逐語で引く
- **`HearingSheet` の型と保存スキーマ `lifeplan.sheet.v2` は変更しない。** 入力経路が変わるだけ
- 金額の表示は既存の `formatCompactYen`（`src/lib/format.ts`）を使う。新しい整形関数を作らない
- DOM を触るテストはファイル先頭に `// @vitest-environment jsdom` を書く（`environment` の既定は node）
- 既存テスト163件を1件も壊さない。`npm test` は常に全件green
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **サブプロジェクト0は課金・AIと無関係。** 認証・Stripe・LLMのコードは1行も書かない

### 選択肢の刻み（設計書 §4.2 より逐語）

| 項目 | 範囲 | 刻み |
|---|---|---|
| 現在年齢 | 18〜80 | 1 |
| リタイア予定年齢 | 45〜80 | 1 |
| 世帯手取り年収 | 100万〜3,000万円 | 10万円 |
| 年間生活費 | 60万〜1,200万円 | 10万円 |
| 貯金 / 投資 | 0〜1億円 | 50万円 |
| 退職金 | 0〜5,000万円 | 50万円 |
| 年金年額 | 0〜500万円 | 5万円 |
| 年金受給開始年齢 | 60〜75 | 1 |
| 子供の年齢 | 0〜22 | 1 |
| 大型支出の金額 | 0〜1億円 | 50万円 |

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/lib/options.ts`（新規） | 選択肢の配列を作る純粋関数と、各項目の定数。DOMに依存しない |
| `src/lib/options.test.ts`（新規） | 上記のテスト（node環境） |
| `src/components/SelectField.tsx`（新規） | ラベル付きの数値プルダウン1つぶん |
| `src/components/SelectField.test.tsx`（新規） | 上記のテスト（jsdom） |
| `src/components/HearingModal.tsx`（新規） | 6ステップのモーダル。進行と「スキップ」を持つ |
| `src/components/HearingModal.test.tsx`（新規） | 上記のテスト（jsdom） |
| `src/components/HearingForm.tsx`（変更） | `NumberField` を `SelectField` に差し替え。警告3件は維持 |
| `src/components/Simulator.tsx`（変更） | モーダルの開閉制御を追加 |
| `src/components/NumberField.tsx` | **削除しない。** 使われなくなるが、Task 3 の差し替えが完了するまで参照が残る |

---

### Task 1: 選択肢の生成

**Files:**
- Create: `src/lib/options.ts`
- Test: `src/lib/options.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `moneyOptions(minYen: number, maxYen: number, stepYen: number): number[]`
  - `intOptions(min: number, max: number): number[]`
  - `withCurrent(options: number[], current: number): number[]`
  - 定数 `INCOME_OPTIONS` / `LIVING_COST_OPTIONS` / `ASSET_OPTIONS` / `LUMP_SUM_OPTIONS` / `PENSION_OPTIONS` / `EVENT_AMOUNT_OPTIONS`（すべて `number[]`）
  - 定数 `CURRENT_AGE_OPTIONS` / `RETIREMENT_AGE_OPTIONS` / `PENSION_START_AGE_OPTIONS` / `CHILD_AGE_OPTIONS`（すべて `number[]`）

**なぜ `withCurrent` が要るか（読み飛ばさないこと）:**
現行フォームは自由入力なので、既存ユーザーの localStorage には刻みに乗らない値
（例: 年収 6,123,456 円）が入っている。`<select>` の `value` が選択肢に無いと、
**ブラウザは先頭の選択肢を表示するのに `sheet` の値は元のまま**という食い違いが起きる。
ユーザーには「年収100万円」と見えているのにグラフは612万円で計算されている、
という最悪の形になる。これを防ぐため、現在値が無ければ選択肢に差し込む。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ASSET_OPTIONS,
  CURRENT_AGE_OPTIONS,
  INCOME_OPTIONS,
  intOptions,
  moneyOptions,
  PENSION_OPTIONS,
  withCurrent,
} from "./options";

describe("moneyOptions", () => {
  it("min から max まで step 刻みで並ぶ", () => {
    expect(moneyOptions(0, 1_000_000, 500_000)).toEqual([0, 500_000, 1_000_000]);
  });

  it("max ちょうどに乗らない場合は max を超えない", () => {
    expect(moneyOptions(0, 900_000, 500_000)).toEqual([0, 500_000]);
  });
});

describe("intOptions", () => {
  it("両端を含む連番になる", () => {
    expect(intOptions(18, 21)).toEqual([18, 19, 20, 21]);
  });
});

describe("withCurrent", () => {
  it("選択肢に無い現在値を昇順の正しい位置に差し込む", () => {
    expect(withCurrent([0, 100, 200], 150)).toEqual([0, 100, 150, 200]);
  });

  it("すでに含まれていれば増やさない", () => {
    expect(withCurrent([0, 100, 200], 100)).toEqual([0, 100, 200]);
  });

  it("NaN は差し込まない", () => {
    expect(withCurrent([0, 100], Number.NaN)).toEqual([0, 100]);
  });

  it("元の配列を書き換えない", () => {
    const base = [0, 100];
    withCurrent(base, 50);
    expect(base).toEqual([0, 100]);
  });
});

describe("各項目の定数", () => {
  it("年収は100万〜3,000万を10万刻み", () => {
    expect(INCOME_OPTIONS[0]).toBe(1_000_000);
    expect(INCOME_OPTIONS.at(-1)).toBe(30_000_000);
    expect(INCOME_OPTIONS[1] - INCOME_OPTIONS[0]).toBe(100_000);
  });

  it("貯金・投資は0円から始まる", () => {
    expect(ASSET_OPTIONS[0]).toBe(0);
    expect(ASSET_OPTIONS.at(-1)).toBe(100_000_000);
  });

  it("年金は0円から5万円刻み", () => {
    expect(PENSION_OPTIONS[0]).toBe(0);
    expect(PENSION_OPTIONS[1]).toBe(50_000);
    expect(PENSION_OPTIONS.at(-1)).toBe(5_000_000);
  });

  it("現在年齢は18〜80", () => {
    expect(CURRENT_AGE_OPTIONS[0]).toBe(18);
    expect(CURRENT_AGE_OPTIONS.at(-1)).toBe(80);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/options.test.ts`
Expected: FAIL（`Failed to resolve import "./options"`）

- [ ] **Step 3: 実装する**

`src/lib/options.ts`:

```ts
/**
 * プルダウンの選択肢。
 *
 * 帯（「400〜500万円」）ではなく細かい刻みにするのは、帯の中央値で計算すると
 * 年収50万円のズレが95歳まで積み上がり、試算の信頼性が落ちるため
 * （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.2）
 */

/** 円単位の選択肢。max を超える値は含めない */
export function moneyOptions(minYen: number, maxYen: number, stepYen: number): number[] {
  const out: number[] = [];
  for (let v = minYen; v <= maxYen; v += stepYen) out.push(v);
  return out;
}

/** 両端を含む整数の連番 */
export function intOptions(min: number, max: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v++) out.push(v);
  return out;
}

/**
 * 現在値が選択肢に無ければ昇順を保って差し込む。
 *
 * ⚠️ これが無いと保存済みデータで表示と実値が食い違う。
 * 旧フォームは自由入力だったので、既存ユーザーの localStorage には
 * 刻みに乗らない値（例: 6,123,456円）が入っている。`<select>` の value が
 * 選択肢に無いとブラウザは先頭を表示するが、sheet の値は変わらない。
 * 「画面には100万円と出ているのにグラフは612万円で計算されている」状態になる
 */
export function withCurrent(options: number[], current: number): number[] {
  if (!Number.isFinite(current)) return options;
  if (options.includes(current)) return options;
  return [...options, current].sort((a, b) => a - b);
}

// --- 各項目の選択肢（設計書 §4.2） ---

export const INCOME_OPTIONS = moneyOptions(1_000_000, 30_000_000, 100_000);
export const LIVING_COST_OPTIONS = moneyOptions(600_000, 12_000_000, 100_000);
export const ASSET_OPTIONS = moneyOptions(0, 100_000_000, 500_000);
export const LUMP_SUM_OPTIONS = moneyOptions(0, 50_000_000, 500_000);
export const PENSION_OPTIONS = moneyOptions(0, 5_000_000, 50_000);
export const EVENT_AMOUNT_OPTIONS = moneyOptions(0, 100_000_000, 500_000);

export const CURRENT_AGE_OPTIONS = intOptions(18, 80);
export const RETIREMENT_AGE_OPTIONS = intOptions(45, 80);
export const PENSION_START_AGE_OPTIONS = intOptions(60, 75);
export const CHILD_AGE_OPTIONS = intOptions(0, 22);
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/lib/options.test.ts`
Expected: PASS（15件）

- [ ] **Step 5: 全体を通してコミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/options.ts src/lib/options.test.ts
git commit -m "feat: プルダウンの選択肢を生成する純粋関数"
```

---

### Task 2: SelectField 部品

**Files:**
- Create: `src/components/SelectField.tsx`
- Test: `src/components/SelectField.test.tsx`

**Interfaces:**
- Consumes: `withCurrent` from `@/lib/options`、`formatCompactYen` from `@/lib/format`
- Produces: `SelectField` コンポーネント。props は
  ```ts
  {
    label: string;
    value: number;
    options: number[];
    onChange: (v: number) => void;
    /** 選択肢の表示文字列。省略時は数値をそのまま出す */
    format?: (v: number) => string;
    suffix?: string;
    hint?: string;
  }
  ```

**設計上の要点:** `withCurrent` は**呼び出し側ではなく `SelectField` の内部**で適用する。
呼び出し箇所は10か所以上あり、1か所でも忘れると §Task 1 の食い違いが起きるため、
忘れようのない場所に置く。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/SelectField.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// select の option 構成と onChange の型を検証するので jsdom が要る。
// 環境指定の作法は src/components/HearingForm.test.tsx に合わせている

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactYen } from "@/lib/format";
import { SelectField } from "./SelectField";

afterEach(() => {
  cleanup();
});

describe("SelectField", () => {
  it("選択すると文字列ではなく数値で通知する", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="年収"
        value={100}
        options={[100, 200, 300]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("年収"), { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith(200);
  });

  it("選択肢に無い現在値でも、その値が選択された状態になる", () => {
    // 旧フォーム（自由入力）で保存された刻み外の値を想定
    render(
      <SelectField
        label="年収"
        value={6_123_456}
        options={[1_000_000, 10_000_000]}
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText("年収") as HTMLSelectElement;
    expect(select.value).toBe("6123456");
    expect(select.options).toHaveLength(3);
  });

  it("format を渡すと表示文字列に使われる", () => {
    render(
      <SelectField
        label="年収"
        value={6_000_000}
        options={[6_000_000]}
        onChange={() => {}}
        format={formatCompactYen}
      />,
    );
    expect(screen.getByRole("option", { name: "600万円" })).toBeInTheDocument();
  });

  it("hint を表示する", () => {
    render(
      <SelectField
        label="年収"
        value={100}
        options={[100]}
        onChange={() => {}}
        hint="配偶者がいれば合算した額"
      />,
    );
    expect(screen.getByText("配偶者がいれば合算した額")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/SelectField.test.tsx`
Expected: FAIL（`Failed to resolve import "./SelectField"`）

- [ ] **Step 3: 実装する**

`src/components/SelectField.tsx`:

```tsx
"use client";

import { useId } from "react";
import { withCurrent } from "@/lib/options";

/**
 * ラベル付きの数値プルダウン。
 *
 * `NumberField`（自由入力）の置き換え。自由入力をやめたことで、
 * 範囲外の値や小数がそのまま計算エンジンへ渡る経路が構造的に消える
 * （年齢に 6.5 が入ると年次ループの整数年と噛み合わず、イベントが
 * 黙って発生しなくなる不具合が起きていた）。
 *
 * ⚠️ withCurrent はここで適用する。呼び出し側に任せると、1か所忘れただけで
 * 「画面の表示と sheet の値が食い違う」状態になる（src/lib/options.ts 参照）
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  format,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  /** 選択肢の表示文字列。省略時は数値をそのまま出す */
  format?: (v: number) => string;
  suffix?: string;
  hint?: string;
}) {
  // label と select を紐づける。同じラベル名の項目が複数あっても衝突しないよう
  // React が採番するIDを使う（「第1子の年齢」「第2子の年齢」など）
  const id = useId();
  const opts = withCurrent(options, value);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <select
          id={id}
          className="w-full rounded border border-slate-300 px-3 py-2 tabular-nums focus:border-slate-500 focus:outline-none"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {opts.map((o) => (
            <option key={o} value={o}>
              {format ? format(o) : o}
            </option>
          ))}
        </select>
        {suffix && <span className="shrink-0 text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/components/SelectField.test.tsx`
Expected: PASS（4件）

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/SelectField.tsx src/components/SelectField.test.tsx
git commit -m "feat: 数値プルダウンの共通部品"
```

---

### Task 3: HearingForm をプルダウン化

**Files:**
- Modify: `src/components/HearingForm.tsx`
- Modify: `src/components/HearingForm.test.tsx`（既存テストの入力操作を select に合わせる）

**Interfaces:**
- Consumes: `SelectField`（Task 2）、`@/lib/options` の各定数（Task 1）
- Produces: 変更なし（props は `{ sheet, onChange }` のまま）

**⚠️ 絶対に消してはいけないもの（設計書 §4.4）**

現行 `HearingForm.tsx` にある警告3つは、**計算エンジンが黙って誤った結果を返す条件**を
可視化している。プルダウンで選択肢を絞っても、**`currentAge` を後から引き上げると
保存済みの値が範囲外になる**ため、選択肢の制限だけでは塞げない。

| 変数名 | 条件 | 放置した場合 |
|---|---|---|
| `isRetirementAgeInvalid` | `sheet.retirementAge < sheet.currentAge` | `age < retirementAge` が全期間 false になり**給与収入が全期間0円**として試算される |
| `isPensionStartAgeInvalid` | `(sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE) < sheet.currentAge` | 入力の意図と食い違ったまま試算される |
| `isOutOfRange`（イベント毎） | `event.age < sheet.currentAge \|\| event.age > LIFE_EXPECTANCY_AGE` | エンジンが**黙って無視**する |

**警告のJSX・文言・`border-amber-400 bg-amber-50` のスタイルはそのまま残すこと。**

- [ ] **Step 1: ガードが残っていることを検証するテストを追加する**

`src/components/HearingForm.test.tsx` の末尾に追記:

```tsx
describe("黙って間違う条件の警告", () => {
  it("リタイア年齢が現在年齢を下回ると警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 60, retirementAge: 50 };
    render(<HearingForm sheet={sheet} onChange={() => {}} />);
    expect(screen.getByText(/給与収入が全期間0円として/)).toBeInTheDocument();
  });

  it("年金受給開始年齢が現在年齢を下回ると警告が出る", () => {
    const sheet: HearingSheet = { ...BASE, currentAge: 70, pensionStartAge: 65 };
    render(<HearingForm sheet={sheet} onChange={() => {}} />);
    expect(screen.getByText(/現在の年齢より前になっています/)).toBeInTheDocument();
  });

  it("試算範囲外のイベントに警告が出る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      currentAge: 40,
      customEvents: [{ id: "e1", age: 30, amount: 1_000_000, label: "住宅購入" }],
    };
    render(<HearingForm sheet={sheet} onChange={() => {}} />);
    expect(screen.getByText(/試算に反映されていません/)).toBeInTheDocument();
  });
});

describe("プルダウン化", () => {
  it("世帯手取り年収が select になっている", () => {
    render(<HearingForm sheet={BASE} onChange={() => {}} />);
    expect(screen.getByLabelText("世帯手取り年収").tagName).toBe("SELECT");
  });

  it("選択すると数値で通知される", () => {
    let latest: HearingSheet = BASE;
    render(<HearingForm sheet={BASE} onChange={(s) => (latest = s)} />);
    fireEvent.change(screen.getByLabelText("世帯手取り年収"), {
      target: { value: "7000000" },
    });
    expect(latest.householdNetIncome).toBe(7_000_000);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/HearingForm.test.tsx`
Expected: 「プルダウン化」の2件が FAIL（`世帯手取り年収` はまだ `INPUT`）。
警告3件は現行実装で既に PASS するはずなので、**ここで落ちたら先に原因を調べること**
（既存の警告が壊れているサイン）。

- [ ] **Step 3: `NumberField` を `SelectField` に差し替える**

`src/components/HearingForm.tsx` の import を差し替える:

```tsx
import { formatCompactYen } from "@/lib/format";
import {
  ASSET_OPTIONS,
  CHILD_AGE_OPTIONS,
  CURRENT_AGE_OPTIONS,
  EVENT_AMOUNT_OPTIONS,
  INCOME_OPTIONS,
  intOptions,
  LIVING_COST_OPTIONS,
  LUMP_SUM_OPTIONS,
  PENSION_OPTIONS,
  PENSION_START_AGE_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { SelectField } from "./SelectField";
```

差し替えの対応表（**`NumberField` の呼び出しをすべて置換する**）:

| 項目 | 置き換え後 |
|---|---|
| 現在の年齢 | `<SelectField label="現在の年齢" value={sheet.currentAge} options={CURRENT_AGE_OPTIONS} onChange={(v) => set("currentAge", v)} suffix="歳" />` |
| 世帯手取り年収 | `<SelectField label="世帯手取り年収" value={sheet.householdNetIncome} options={INCOME_OPTIONS} onChange={(v) => set("householdNetIncome", v)} format={formatCompactYen} hint="配偶者がいれば合算した額" />` |
| 年間の基本生活費 | `<SelectField label="年間の基本生活費" value={sheet.annualLivingCost} options={LIVING_COST_OPTIONS} onChange={(v) => set("annualLivingCost", v)} format={formatCompactYen} hint="月30万円なら 360万円" />` |
| 現在の貯金 | `<SelectField label="現在の貯金" value={sheet.savings} options={ASSET_OPTIONS} onChange={(v) => set("savings", v)} format={formatCompactYen} hint="利回りがつかない現金" />` |
| 現在の投資額 | `<SelectField label="現在の投資額" value={sheet.investments} options={ASSET_OPTIONS} onChange={(v) => set("investments", v)} format={formatCompactYen} hint="利回りが適用される資産" />` |
| リタイア予定年齢 | `<SelectField label="リタイア予定年齢" value={sheet.retirementAge} options={RETIREMENT_AGE_OPTIONS} onChange={(v) => set("retirementAge", v)} suffix="歳" />` |
| 退職金 | `<SelectField label="退職金" value={sheet.retirementLumpSum ?? 0} options={LUMP_SUM_OPTIONS} onChange={(v) => set("retirementLumpSum", v)} format={formatCompactYen} hint="リタイアした年に一度だけ加算されます" />` |
| 年金の年額 | `<SelectField label="年金の年額" value={sheet.pensionAnnual ?? 0} options={PENSION_OPTIONS} onChange={(v) => set("pensionAnnual", v)} format={formatCompactYen} hint="ねんきんネットの見込額を入れてください" />` |
| 年金の受給開始年齢 | `<SelectField label="年金の受給開始年齢" value={sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE} options={PENSION_START_AGE_OPTIONS} onChange={(v) => set("pensionStartAge", v)} suffix="歳" />` |
| 第N子の年齢 | `<SelectField label={\`第${i + 1}子の年齢\`} value={child.age} options={CHILD_AGE_OPTIONS} onChange={(v) => setChild(i, { age: v })} suffix="歳" />` |
| イベントの発生する年齢 | `<SelectField label="発生する年齢" value={event.age} options={intOptions(sheet.currentAge, LIFE_EXPECTANCY_AGE)} onChange={(v) => setEvent(i, { age: v })} suffix="歳" />` |
| イベントの金額 | `<SelectField label="金額" value={event.amount} options={EVENT_AMOUNT_OPTIONS} onChange={(v) => setEvent(i, { amount: v })} format={formatCompactYen} />` |

**イベントの発生年齢だけ `intOptions(sheet.currentAge, LIFE_EXPECTANCY_AGE)` を動的に作る。**
定数にすると現在年齢より前の年を選べてしまい、エンジンが黙って無視する状態を
自分で作ることになるため。

イベントの「内容」は自由入力の `<input type="text">` のまま**変更しない**
（ラベル文字列なので刻みの概念がない）。

`NumberField` の import は削除する。

- [ ] **Step 4: 既存テストの `toHaveValue` を文字列に直す**

⚠️ **これをやらないと `Simulator.test.tsx` が6か所で落ちる。**

`<input type="number">` に対する `toHaveValue` は**数値**を返すが、
`<select>` に対しては**文字列**を返す（jest-dom の仕様）。
`現在の年齢` を select に変えた時点で、既存の以下の assertion がすべて失敗する。

`src/components/Simulator.test.tsx` の該当箇所を書き換える:

| 現在 | 変更後 |
|---|---|
| `expect(input).toHaveValue(DEFAULT_SHEET.currentAge)` | `expect(input).toHaveValue(String(DEFAULT_SHEET.currentAge))` |
| `expect(input).toHaveValue(52)` | `expect(input).toHaveValue("52")` |
| `expect(input).toHaveValue(50)` | `expect(input).toHaveValue("50")` |
| `expect(input).toHaveValue(60)` | `expect(input).toHaveValue("60")` |

（`toHaveValue(DEFAULT_SHEET.currentAge)` は2か所、他は各1か所。**計6か所。**
`grep -n "toHaveValue" src/components/Simulator.test.tsx` で漏れが無いか確認すること）

`NumberField.test.tsx` は**触らない。** `NumberField` 自体は変えていないので、
そのテストは数値のままで正しい。

- [ ] **Step 5: 成功を確認する**

Run: `npm test`
Expected: PASS（全件）

- [ ] **Step 6: 全体を確認してコミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/HearingForm.tsx src/components/HearingForm.test.tsx
git commit -m "feat: ヒアリングフォームをプルダウン化"
```

⚠️ `npm run lint` が `NumberField` の未使用を指摘したら、**削除せずに残す。**
Task 3 の時点では他から参照されていないだけで、削除は別タスクの判断
（`NumberField.test.tsx` も一緒に消す必要がある）。lint が `error` で止まる場合のみ、
`src/components/NumberField.tsx` と `src/components/NumberField.test.tsx` を
同じコミットで削除する。

---

### Task 4: ステップ式モーダル

**Files:**
- Create: `src/components/HearingModal.tsx`
- Test: `src/components/HearingModal.test.tsx`

**Interfaces:**
- Consumes: `SelectField`（Task 2）、`@/lib/options` の定数（Task 1）、`HearingSheet` from `@/lib/lifeplan/types`
- Produces: `HearingModal` コンポーネント。props は
  ```ts
  {
    sheet: HearingSheet;
    onChange: (sheet: HearingSheet) => void;
    open: boolean;
    onClose: () => void;
  }
  ```

**ステップ構成（設計書 §4.1）:**

| Step | 見出し | 項目 | スキップ |
|---|---|---|---|
| 0 | あなたのこと | 現在年齢・職業・リタイア予定年齢 | 不可 |
| 1 | お金の流れ | 世帯手取り年収・年間生活費 | 不可 |
| 2 | いまの資産 | 貯金・投資 | 不可 |
| 3 | 家族 | 子供の人数・年齢・進路 | 可 |
| 4 | 老後 | 退職金・年金年額・受給開始年齢 | 可 |
| 5 | 大きな支出 | 住宅購入など | 可 |

**「わからない場合の目安」（設計書 §4.3）** を各ステップに置く。無料版の価値を直接押し上げる。

**`<dialog>` は使わない。** jsdom の `showModal()` サポートが環境依存で、
テストが実装ではなく環境の都合で落ちる。`role="dialog"` + `aria-modal="true"` の
div で組む。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/HearingModal.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// ステップ進行と開閉を検証するので jsdom が要る

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { HearingModal } from "./HearingModal";

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

describe("HearingModal", () => {
  it("open が false なら何も描画しない", () => {
    render(
      <HearingModal sheet={BASE} onChange={() => {}} open={false} onClose={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("最初のステップは「あなたのこと」", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("「次へ」で2番目のステップに進む", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("お金の流れ");
  });

  it("「戻る」で前のステップに戻る", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("最初のステップには「戻る」が無い", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "戻る" })).not.toBeInTheDocument();
  });

  it("必須の3ステップには「スキップ」が無い", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByRole("button", { name: "スキップ" })).not.toBeInTheDocument();
  });

  it("4番目以降のステップには「スキップ」がある", () => {
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("button", { name: "スキップ" })).toBeInTheDocument();
  });

  it("最後のステップの「結果を見る」で閉じる", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape で閉じる", () => {
    const onClose = vi.fn();
    render(<HearingModal sheet={BASE} onChange={() => {}} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ステップ内の選択が sheet に反映される", () => {
    let latest: HearingSheet = BASE;
    render(<HearingModal sheet={BASE} onChange={(s) => (latest = s)} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("現在の年齢"), { target: { value: "45" } });
    expect(latest.currentAge).toBe(45);
  });

  it("開き直すと最初のステップから始まる", () => {
    const { rerender } = render(
      <HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    rerender(
      <HearingModal sheet={BASE} onChange={() => {}} open={false} onClose={() => {}} />,
    );
    rerender(<HearingModal sheet={BASE} onChange={() => {}} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/HearingModal.test.tsx`
Expected: FAIL（`Failed to resolve import "./HearingModal"`）

- [ ] **Step 3: 実装する**

`src/components/HearingModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { formatCompactYen } from "@/lib/format";
import { newRowId } from "@/lib/id";
import type { Child, HearingSheet, LifeEvent, Occupation } from "@/lib/lifeplan/types";
import {
  ASSET_OPTIONS,
  CHILD_AGE_OPTIONS,
  CURRENT_AGE_OPTIONS,
  EVENT_AMOUNT_OPTIONS,
  INCOME_OPTIONS,
  intOptions,
  LIVING_COST_OPTIONS,
  LUMP_SUM_OPTIONS,
  PENSION_OPTIONS,
  PENSION_START_AGE_OPTIONS,
  RETIREMENT_AGE_OPTIONS,
} from "@/lib/options";
import { SelectField } from "./SelectField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/** ステップの見出し。index がそのままステップ番号になる */
const STEP_TITLES = [
  "あなたのこと",
  "お金の流れ",
  "いまの資産",
  "家族",
  "老後",
  "大きな支出",
] as const;

/** ここから先はスキップできる（Tier 2）。0〜2 は必須（Tier 1） */
const FIRST_OPTIONAL_STEP = 3;

/**
 * ステップ式のヒアリングモーダル。
 *
 * 初回訪問で自動的に開き、何を入れればいいか分からない人を最後まで導く。
 * 2回目以降の微調整は横並びの HearingForm で行う（即座に再計算される体験を
 * 失わせないため。docs/requirements.md §6）。
 *
 * <dialog> を使わないのは、jsdom の showModal() サポートが環境依存で、
 * テストが実装ではなく環境の都合で落ちるため
 */
export function HearingModal({
  sheet,
  onChange,
  open,
  onClose,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  // 開き直したときは最初から始める。前回の途中位置を覚えていると、
  // 「入力をやり直す」を押したのに5ステップ目が出る、という挙動になる
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setStep(0);
  }, [open]);

  // Escape で閉じる。モーダルの慣習であり、これが無いと閉じ方が
  // 「結果を見る」まで進むしかなくなる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const children = sheet.children ?? [];
  const events = sheet.customEvents ?? [];

  const setChild = (index: number, patch: Partial<Child>) =>
    set("children", children.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const setEvent = (index: number, patch: Partial<LifeEvent>) =>
    set("customEvents", events.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const isLast = step === STEP_TITLES.length - 1;
  const canSkip = step >= FIRST_OPTIONAL_STEP;

  const advance = () => (isLast ? onClose() : setStep(step + 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={STEP_TITLES[step]}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <p className="text-xs text-slate-500">
          ステップ {step + 1} / {STEP_TITLES.length}
        </p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">{STEP_TITLES[step]}</h2>

        <div className="mt-5 flex flex-col gap-4">
          {step === 0 && (
            <>
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
                label="リタイア予定年齢"
                value={sheet.retirementAge}
                options={RETIREMENT_AGE_OPTIONS}
                onChange={(v) => set("retirementAge", v)}
                suffix="歳"
                hint="働くのをやめる予定の年齢。決めていなければ65歳のままで構いません"
              />
            </>
          )}

          {step === 1 && (
            <>
              <SelectField
                label="世帯手取り年収"
                value={sheet.householdNetIncome}
                options={INCOME_OPTIONS}
                onChange={(v) => set("householdNetIncome", v)}
                format={formatCompactYen}
                hint="配偶者がいれば合算した額。源泉徴収票の「支払金額」ではなく、実際に振り込まれる額です"
              />
              <SelectField
                label="年間の基本生活費"
                value={sheet.annualLivingCost}
                options={LIVING_COST_OPTIONS}
                onChange={(v) => set("annualLivingCost", v)}
                format={formatCompactYen}
                hint="わからなければ「手取り年収 − 1年間で増えた貯金額」で概算できます"
              />
            </>
          )}

          {step === 2 && (
            <>
              <SelectField
                label="現在の貯金"
                value={sheet.savings}
                options={ASSET_OPTIONS}
                onChange={(v) => set("savings", v)}
                format={formatCompactYen}
                hint="普通預金・定期預金など、利回りがつかないお金"
              />
              <SelectField
                label="現在の投資額"
                value={sheet.investments}
                options={ASSET_OPTIONS}
                onChange={(v) => set("investments", v)}
                format={formatCompactYen}
                hint="NISA・iDeCo・投資信託など、利回りが適用される資産の時価"
              />
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-slate-500">
                登録すると、進学時期に合わせた教育費が自動で支出に計上されます。
                お子さんがいなければスキップしてください。
              </p>
              {children.map((child, i) => (
                <div
                  key={child.id}
                  className="flex items-end gap-2 rounded border border-slate-200 p-3"
                >
                  <div className="flex-1">
                    <SelectField
                      label={`第${i + 1}子の年齢`}
                      value={child.age}
                      options={CHILD_AGE_OPTIONS}
                      onChange={(v) => setChild(i, { age: v })}
                      suffix="歳"
                    />
                  </div>
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    <span className="font-medium text-slate-700">進路</span>
                    <select
                      className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                      value={child.path}
                      onChange={(e) => setChild(i, { path: e.target.value as Child["path"] })}
                    >
                      <option value="public">公立</option>
                      <option value="private">私立</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`第${i + 1}子を削除`}
                    className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                    onClick={() => set("children", children.filter((_, j) => j !== i))}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                aria-label="子供を追加"
                className="self-start rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                onClick={() =>
                  set("children", [...children, { id: newRowId(), age: 0, path: "public" }])
                }
              >
                子供を追加
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <SelectField
                label="退職金"
                value={sheet.retirementLumpSum ?? 0}
                options={LUMP_SUM_OPTIONS}
                onChange={(v) => set("retirementLumpSum", v)}
                format={formatCompactYen}
                hint="リタイアした年に一度だけ加算されます。就業規則の退職金規程で確認できます"
              />
              <SelectField
                label="年金の年額"
                value={sheet.pensionAnnual ?? 0}
                options={PENSION_OPTIONS}
                onChange={(v) => set("pensionAnnual", v)}
                format={formatCompactYen}
                hint="「ねんきんネット」で見込額を確認できます。0円のままだと年金が一切ない前提で試算されます"
              />
              <SelectField
                label="年金の受給開始年齢"
                value={sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE}
                options={PENSION_START_AGE_OPTIONS}
                onChange={(v) => set("pensionStartAge", v)}
                suffix="歳"
                hint="上の金額は65歳から受け取る場合の額として扱います"
              />
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-xs text-slate-500">
                住宅購入・車の買い替え・リフォームなど、特定の年にまとまって出ていくお金を登録できます。
                予定がなければスキップしてください。
              </p>
              {events.map((event, i) => (
                <div key={event.id} className="flex flex-col gap-2 rounded border border-slate-200 p-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-slate-700">内容</span>
                    <input
                      type="text"
                      className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                      value={event.label}
                      onChange={(e) => setEvent(i, { label: e.target.value })}
                    />
                  </label>
                  <SelectField
                    label="発生する年齢"
                    value={event.age}
                    options={intOptions(sheet.currentAge, LIFE_EXPECTANCY_AGE)}
                    onChange={(v) => setEvent(i, { age: v })}
                    suffix="歳"
                  />
                  <SelectField
                    label="金額"
                    value={event.amount}
                    options={EVENT_AMOUNT_OPTIONS}
                    onChange={(v) => setEvent(i, { amount: v })}
                    format={formatCompactYen}
                  />
                  <button
                    type="button"
                    aria-label={`「${event.label || `イベント${i + 1}`}」を削除`}
                    className="self-start rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                    onClick={() => set("customEvents", events.filter((_, j) => j !== i))}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                aria-label="大きな支出の予定を追加"
                className="self-start rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
                onClick={() =>
                  set("customEvents", [
                    ...events,
                    {
                      id: newRowId(),
                      age: Math.min(sheet.currentAge + 5, LIFE_EXPECTANCY_AGE),
                      amount: 30_000_000,
                      label: "住宅購入",
                    },
                  ])
                }
              >
                大きな支出の予定を追加
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
          <div>
            {step > 0 && (
              <button
                type="button"
                className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
                onClick={() => setStep(step - 1)}
              >
                戻る
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {canSkip && (
              <button
                type="button"
                className="rounded px-4 py-2 text-sm text-slate-500 underline hover:text-slate-800"
                onClick={advance}
              >
                スキップ
              </button>
            )}
            <button
              type="button"
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              onClick={advance}
            >
              {isLast ? "結果を見る" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/components/HearingModal.test.tsx`
Expected: PASS（11件）

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/HearingModal.tsx src/components/HearingModal.test.tsx
git commit -m "feat: ステップ式のヒアリングモーダル"
```

---

### Task 5: Simulator への組み込み

**Files:**
- Modify: `src/components/Simulator.tsx`
- Modify: `src/components/Simulator.test.tsx`

**Interfaces:**
- Consumes: `HearingModal`（Task 4）
- Produces: 変更なし（`Simulator` は引数を取らない）

**⚠️ 既存の localStorage 復元ロジックを壊さないこと。**
`Simulator.tsx` には2つの繊細な仕掛けがあり、どちらもコメントで理由が書かれている。

1. `useEffect` 内での `loadSheet()`（静的エクスポートのプリレンダリングでは
   localStorage を触れないため。レンダー中に読むと hydration 不一致になる）
2. `skipFirstSave` の ref（復元が反映される前に既定値で上書きするのを防ぐ）

**モーダルの自動オープンは、この復元エフェクトと同じ場所で決める。**
別のエフェクトにすると、復元前に「保存が無い」と判定して毎回開いてしまう。

**⚠️ 既存テスト2件が壊れる。先に読むこと。**

モーダルと横フォームは**同じラベル文字列**（「現在の年齢」など）を持つ。
保存が無いときモーダルが自動で開くと、`findByLabelText(/^現在の年齢/)` が
**2件に一致して例外を投げる**（`Found multiple elements`）。

`saveSheet()` を呼んでいない既存テストが該当する:

1. 「localStorageに何も保存されていなければ既定値（DEFAULT_SHEET）を表示する」
2. 「入力を変更するとlocalStorageに保存される」

**対処:** この2件で、フォームを触る前にモーダルを閉じる。
実際のユーザーもモーダルを終えてから横のフォームを触るので、
テストの筋としても正しい。両テストの `render(<Simulator />);` の直後に追加する:

```tsx
// モーダルが自動で開くとラベルが二重になるので、先に閉じる
fireEvent.keyDown(document, { key: "Escape" });
```

`saveSheet()` を呼んでいる他の2件は、モーダルが開かないので**変更不要**。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/Simulator.test.tsx` の末尾に追記:

```tsx
describe("初回訪問のモーダル", () => {
  it("保存が無ければモーダルが開く", async () => {
    localStorage.clear();
    render(<Simulator />);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("あなたのこと");
  });

  it("保存があればモーダルは開かない", async () => {
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
    // 復元エフェクトが走りきるのを待ってから確認する
    expect(await screen.findByText("入力をやり直す")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("「入力をやり直す」でモーダルが開く", async () => {
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
    fireEvent.click(await screen.findByText("入力をやり直す"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

`fireEvent` の import と `beforeEach(() => localStorage.clear())` は
**既存ファイルにすでにある。** 追加不要。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/Simulator.test.tsx`
Expected: 追加した3件が FAIL（`dialog` も「入力をやり直す」も存在しない）

- [ ] **Step 3: 実装する**

`src/components/Simulator.tsx` を変更する。

import に追加:

```tsx
import { HearingModal } from "./HearingModal";
```

state を追加（`sheet` の宣言の直後）:

```tsx
const [modalOpen, setModalOpen] = useState(false);
```

**復元エフェクトを次の形に差し替える**（`else` の分岐を足すだけ。既存のコメントは残す）:

```tsx
useEffect(() => {
  const saved = loadSheet();
  if (saved) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheet(saved);
  } else {
    // 保存が無い＝初回訪問。何を入れればいいか分からない人を
    // ステップ式の入力に案内する。復元と同じエフェクトで判定するのは、
    // 別エフェクトにすると復元前に「保存が無い」と誤判定して
    // 毎回開いてしまうため
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModalOpen(true);
  }
}, []);
```

**JSX の最上位に `HearingModal` を追加する。** 既存の `<div className="grid ...">` を
フラグメントで包み、その中にモーダルを置く:

```tsx
return (
  <>
    <HearingModal
      sheet={sheet}
      onChange={setSheet}
      open={modalOpen}
      onClose={() => setModalOpen(false)}
    />
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* ...既存のまま... */}
    </div>
  </>
);
```

**「入力をやり直す」ボタンを追加する。** 既存の「入力内容を消して初期値に戻す」の
すぐ上に置く:

```tsx
<button
  type="button"
  className="self-start text-xs text-slate-600 underline hover:text-slate-900"
  onClick={() => setModalOpen(true)}
>
  入力をやり直す
</button>
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/components/Simulator.test.tsx`
Expected: PASS（既存分＋新規3件）

- [ ] **Step 5: 全件確認してコミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/Simulator.tsx src/components/Simulator.test.tsx
git commit -m "feat: 初回訪問でヒアリングモーダルを開く"
```

- [ ] **Step 6: 本番で目視する**

```bash
npm run deploy
```

**デプロイ後、必ずブラウザで実際に触ること。**
このプロジェクトでは、テスト・型チェック・lint・コードレビューをすべて通過した
recharts の軸設定が本番で初めて壊れていた事例がある（`domain` が
`allowDataOverflow` 無しでは効かず、Y軸が-5億円まで伸びていた）。

確認する項目:

1. シークレットウィンドウで開き、**モーダルが自動で開く**こと
2. 6ステップすべてを進み、**「結果を見る」で閉じてグラフが出る**こと
3. 再読み込みして**モーダルが開かない**こと
4. 「入力をやり直す」で**再び開く**こと
5. 横のフォームでプルダウンを変え、**グラフが即座に動く**こと
6. スマートフォン幅で**モーダルが画面外にはみ出さない**こと

---

## Self-Review

**1. 仕様カバレッジ（設計書 §4 との突き合わせ）**

| 設計書 | 対応するタスク |
|---|---|
| §4.1 ステップ構成（6ステップ・Tier1必須） | Task 4 |
| §4.1 モーダルと横フォームの併存 | Task 4・Task 5 |
| §4.1 初回自動オープン／「入力をやり直す」 | Task 5 |
| §4.2 プルダウンの刻み（10項目） | Task 1（定数）・Task 3/4（適用） |
| §4.3 「わからない場合の目安」ヒント | Task 4（各ステップの `hint`） |
| §4.4 既存の警告3件の維持 | Task 3（テストで固定） |
| §4.5 保存スキーマ据え置き | 全タスク（`HearingSheet` を触らない） |

**gap なし。**

**2. プレースホルダ走査**

「TBD」「後で」「適切に」「同様に」は無し。全ステップに実際のコードを記載済み。

**3. 既存テストへの影響（実際にファイルを開いて確認済み）**

| 影響 | 発生するタスク | 対処 |
|---|---|---|
| `toHaveValue(<数値>)` が6か所で失敗（select の値は文字列） | Task 3 | Task 3 Step 4 |
| ラベルが二重になり `findByLabelText` が例外（既存2件） | Task 5 | Task 5 冒頭の注記 |

**4. 型の整合**

- `moneyOptions` / `intOptions` / `withCurrent` の署名は Task 1 の定義と
  Task 2〜4 の使用箇所で一致
- `SelectField` の props（`label` / `value` / `options` / `onChange` / `format` /
  `suffix` / `hint`）は Task 2 の定義と Task 3・4 の使用箇所で一致
- `HearingModal` の props（`sheet` / `onChange` / `open` / `onClose`）は
  Task 4 の定義と Task 5 の使用箇所で一致
- `formatCompactYen` は既存の `src/lib/format.ts` の実際の署名
  `(value: number) => string` と一致
