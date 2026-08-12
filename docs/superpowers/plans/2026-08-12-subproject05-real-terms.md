# サブプロジェクト0.5：シナリオ前提と表示単位の是正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 試算結果を**今日の購買力（実質）**で表示し、悲観シナリオを「破滅」から「悪いが起こりうる未来」に戻す。

**Architecture:** 計算エンジン（`src/lib/lifeplan/cashflow.ts`）は**一切変更しない**。名目の結果を `(1 + インフレ率)^経過年数` で割る純粋関数を新設し、表示の境界で適用する。シナリオ定数は「実質」で持ち、エンジンに渡す直前に名目へ戻す。

**Tech Stack:** TypeScript / React 19 / Vitest 4

## Global Constraints

- 設計の正は `docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md` **§4.6**。数値はそこから逐語で引く
- **`src/lib/lifeplan/cashflow.ts` を変更しない。** 既存の163テストが守っている計算仕様は不変
- **`HearingSheet` の型と保存スキーマ `lifeplan.sheet.v2` を変更しない**
- 金額の整形は既存の `formatCompactYen`（`src/lib/format.ts`）を使う。新しい整形関数を作らない
- DOM を触るテストのみ `// @vitest-environment jsdom`（既定は node）
- 既存テスト222件を1件も壊さない
- 各タスクの最後に `npm test && npm run typecheck && npm run lint` を通してからコミットする
- **認証・課金・AI・Worker のコードは1行も触らない。** このサブプロジェクトは表示と定数だけ
- コミットメッセージ本文の末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を入れる

### この変更が安全である理由（読み飛ばさないこと）

名目モデルの結果を `(1+インフレ率)^n` で割った値は、実質モデルで計算した値と
**数学的に完全に一致する。** だから割るだけでよい。

さらに **`depletionAge` と `temporaryShortfall` は割り算で変わらない。**
`(1+i)^n` は常に正なので、`total < 0` の真偽が変わらないため。
**このツールの主指標は影響を受けない。** リスクは表示される金額に限定される。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/lib/lifeplan/realTerms.ts`（新規） | 名目→実質の変換。純粋関数 |
| `src/lib/lifeplan/realTerms.test.ts`（新規） | 上記のテスト（node） |
| `src/constants/lifeplan.ts`（変更） | シナリオ定数を実質で持ち、名目へ戻す |
| `src/constants/lifeplan.test.ts`（変更） | 定数のテストを追加 |
| `src/components/Simulator.tsx`（変更） | 実質へ変換してから表示部品に渡す |
| `src/components/DepletionVerdict.tsx`（変更） | 「今日のお金で」を明示、95歳時点を補助情報に落とす |
| `src/components/CashflowChart.tsx`（変更） | 実質値で描画。軸ラベルに単位を明示 |

---

### Task 1: 名目→実質の変換

**Files:**
- Create: `src/lib/lifeplan/realTerms.ts`
- Test: `src/lib/lifeplan/realTerms.test.ts`

**Interfaces:**
- Consumes: `ScenarioResult` / `YearRow` from `./types`
- Produces:
  - `deflate(nominalYen: number, inflationPct: number, yearsElapsed: number): number`
  - `toRealTerms(scenario: ScenarioResult, inflationPct: number): ScenarioResult`

`toRealTerms` は `rows` の各金額（`income` / `expense` / `balance` / `savings` /
`investments` / `total`）と `finalTotal` を実質へ変換した**新しいオブジェクト**を返す。
**`depletionAge` / `temporaryShortfall` / `age` / `events` / `key` / `label` はそのまま**。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lifeplan/realTerms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deflate, toRealTerms } from "./realTerms";
import type { ScenarioResult, YearRow } from "./types";

function row(age: number, total: number): YearRow {
  return {
    age,
    income: total,
    expense: 0,
    balance: total,
    savings: total,
    investments: 0,
    total,
    events: [],
  };
}

describe("deflate", () => {
  it("経過0年なら変わらない", () => {
    expect(deflate(1_000_000, 2, 0)).toBe(1_000_000);
  });

  it("インフレ0%なら何年経っても変わらない", () => {
    expect(deflate(1_000_000, 0, 30)).toBe(1_000_000);
  });

  it("インフレ2%・1年で 1/1.02 になる", () => {
    expect(deflate(1_020_000, 2, 1)).toBe(1_000_000);
  });

  it("マイナスの値も同じ率で縮む", () => {
    expect(deflate(-1_020_000, 2, 1)).toBe(-1_000_000);
  });

  it("整数に丸める", () => {
    expect(Number.isInteger(deflate(1_000_000, 3, 7))).toBe(true);
  });
});

describe("toRealTerms", () => {
  const nominal: ScenarioResult = {
    key: "baseline",
    label: "普通",
    rows: [row(40, 1_000_000), row(41, 1_020_000)],
    depletionAge: null,
    temporaryShortfall: false,
    finalTotal: 1_020_000,
  };

  it("先頭の年（経過0年）は変わらない", () => {
    expect(toRealTerms(nominal, 2).rows[0].total).toBe(1_000_000);
  });

  it("翌年はインフレ1年分だけ割り引かれる", () => {
    expect(toRealTerms(nominal, 2).rows[1].total).toBe(1_000_000);
  });

  it("finalTotal は最終年の経過年数で割り引く", () => {
    expect(toRealTerms(nominal, 2).finalTotal).toBe(1_000_000);
  });

  it("枯渇年齢と一時的資金不足は変えない（主指標は不変）", () => {
    const depleted: ScenarioResult = {
      ...nominal,
      depletionAge: 79,
      temporaryShortfall: false,
    };
    const real = toRealTerms(depleted, 3);
    expect(real.depletionAge).toBe(79);
    expect(real.temporaryShortfall).toBe(false);
  });

  it("年齢とイベントラベルはそのまま残る", () => {
    const withEvent: ScenarioResult = {
      ...nominal,
      rows: [{ ...row(40, 1_000_000), events: ["長子 小学校"] }],
    };
    const real = toRealTerms(withEvent, 2);
    expect(real.rows[0].age).toBe(40);
    expect(real.rows[0].events).toEqual(["長子 小学校"]);
  });

  it("元のオブジェクトを書き換えない", () => {
    const before = nominal.rows[1].total;
    toRealTerms(nominal, 2);
    expect(nominal.rows[1].total).toBe(before);
  });

  it("空のシナリオでも落ちない", () => {
    const empty: ScenarioResult = { ...nominal, rows: [], finalTotal: 0 };
    expect(toRealTerms(empty, 2).rows).toEqual([]);
    expect(toRealTerms(empty, 2).finalTotal).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/lifeplan/realTerms.test.ts`
Expected: FAIL（`Failed to resolve import "./realTerms"`）

- [ ] **Step 3: 実装する**

`src/lib/lifeplan/realTerms.ts`:

```ts
import type { ScenarioResult, YearRow } from "./types";

/**
 * 名目額を「今日の購買力」に直す（docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6）。
 *
 * なぜ必要か: シナリオごとにインフレ率が違うため、名目の3つの数字は
 * **それぞれ購買力の違う「円」**で書かれている。32.8億円（1%インフレの円）と
 * 7.4億円（2%インフレの円）を直接比べるのは、異なる単位の量を比べているのと同じ。
 *
 * なぜ計算エンジンを書き換えないか: 名目モデルの結果をこの式で割った値は、
 * 実質モデルで計算した値と数学的に完全に一致する。エンジンの計算仕様
 * （src/lib/lifeplan/cashflow.ts、163テストが守っている）に触れる理由が無い。
 */
export function deflate(nominalYen: number, inflationPct: number, yearsElapsed: number): number {
  return Math.round(nominalYen / (1 + inflationPct / 100) ** yearsElapsed);
}

/**
 * シナリオ結果の全金額を実質に変換する。
 *
 * ⚠️ `depletionAge` と `temporaryShortfall` は変換しない。
 * `(1+i)^n` は常に正なので `total < 0` の真偽が変わらず、割り算で値も変わらない。
 * **このツールの主指標は実質・名目のどちらで見ても同一**であり、
 * この変換のリスクは表示される金額だけに限定される。
 */
export function toRealTerms(scenario: ScenarioResult, inflationPct: number): ScenarioResult {
  const [first] = scenario.rows;
  // 先頭の年を「今日」とする。currentAge を別途受け取らずに済ませるため、
  // rows の先頭の年齢を基準にする（rows は現在年齢から始まる）
  const baseAge = first?.age ?? 0;

  const rows: YearRow[] = scenario.rows.map((r) => {
    const n = r.age - baseAge;
    return {
      ...r,
      income: deflate(r.income, inflationPct, n),
      expense: deflate(r.expense, inflationPct, n),
      balance: deflate(r.balance, inflationPct, n),
      savings: deflate(r.savings, inflationPct, n),
      investments: deflate(r.investments, inflationPct, n),
      total: deflate(r.total, inflationPct, n),
    };
  });

  const lastAge = scenario.rows.at(-1)?.age ?? baseAge;

  return {
    ...scenario,
    rows,
    finalTotal: deflate(scenario.finalTotal, inflationPct, lastAge - baseAge),
  };
}
```

- [ ] **Step 4: 成功を確認する**

Run: `npx vitest run src/lib/lifeplan/realTerms.test.ts`
Expected: PASS（13件）

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/lifeplan/realTerms.ts src/lib/lifeplan/realTerms.test.ts
git commit -m "feat: 名目額を今日の購買力に直す変換"
```

---

### Task 2: シナリオ定数を実質で持つ

**Files:**
- Modify: `src/constants/lifeplan.ts`
- Modify: `src/constants/lifeplan.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `SCENARIOS`（型・キーは現状のまま `ScenarioAssumption[]`。**値だけが変わる**）

**エンジンには従来どおり名目の値を渡す。** 定数を実質で書き、名目へ戻して `SCENARIOS` を作る。

変換式:

```
名目利回り = (1 + 実質利回り) × (1 + インフレ率) − 1
名目昇給   = (1 + 実質昇給)   × (1 + インフレ率) − 1
```

設計書 §4.6.3 の値（**逐語**）:

| | 実質利回り | 実質昇給 | インフレ | 年金スライド |
|---|---|---|---|---|
| 楽観 | 5% | +1% | 1% | 0% |
| 普通 | 3% | 0% | 2% | 0.5% |
| 悲観 | 1% | −1% | 3% | 1.0% |

- [ ] **Step 1: 失敗するテストを書く**

`src/constants/lifeplan.test.ts` の末尾に追記:

```ts
import { REAL_SCENARIOS, SCENARIOS } from "./lifeplan";

describe("シナリオ定数（実質ベース）", () => {
  it("実質の値が設計書 §4.6.3 のとおり", () => {
    expect(REAL_SCENARIOS.map((s) => [s.key, s.realReturnPct, s.realRaisePct])).toEqual([
      ["optimistic", 5, 1],
      ["baseline", 3, 0],
      ["pessimistic", 1, -1],
    ]);
  });

  it("インフレ率と年金スライドは従来どおり", () => {
    expect(SCENARIOS.map((s) => [s.inflationPct, s.pensionSlidePct])).toEqual([
      [1, 0],
      [2, 0.5],
      [3, 1],
    ]);
  });

  it("名目利回りは (1+実質)×(1+インフレ)-1 になる", () => {
    // 楽観: 1.05 × 1.01 - 1 = 6.05%
    expect(SCENARIOS[0].returnPct).toBeCloseTo(6.05, 6);
    // 普通: 1.03 × 1.02 - 1 = 5.06%
    expect(SCENARIOS[1].returnPct).toBeCloseTo(5.06, 6);
    // 悲観: 1.01 × 1.03 - 1 = 4.03%
    expect(SCENARIOS[2].returnPct).toBeCloseTo(4.03, 6);
  });

  it("名目昇給は (1+実質昇給)×(1+インフレ)-1 になる", () => {
    // 楽観: 1.01 × 1.01 - 1 = 2.01%
    expect(SCENARIOS[0].raisePct).toBeCloseTo(2.01, 6);
    // 普通: 1.00 × 1.02 - 1 = 2.00%
    expect(SCENARIOS[1].raisePct).toBeCloseTo(2.0, 6);
    // 悲観: 0.99 × 1.03 - 1 = 1.97%
    expect(SCENARIOS[2].raisePct).toBeCloseTo(1.97, 6);
  });

  it("悲観の実質昇給が -1% であること（-2.9% は破滅シナリオだった）", () => {
    // 36年で実質収入が7割に。日本の実績に近く「悪いが起こりうる」範囲。
    // 変更前の実質 -2.91% は36年で3分の1になり、誰が試算しても破綻していた
    expect(REAL_SCENARIOS[2].realRaisePct).toBe(-1);
    expect(0.99 ** 36).toBeGreaterThan(0.69);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/constants/lifeplan.test.ts`
Expected: FAIL（`REAL_SCENARIOS` が存在しない）

- [ ] **Step 3: 実装する**

`src/constants/lifeplan.ts` の `SCENARIOS` の定義を置き換える:

```ts
/**
 * シナリオの前提を**実質（今日の購買力ベース）**で持つ
 * （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6.3）。
 *
 * なぜ実質で持つか: 名目で持つと「昇給0%・インフレ3%」のような書き方になり、
 * それが「実質賃金が毎年2.9%下がり続ける」を意味することが読み取れない。
 * 実際、変更前の悲観シナリオはリタイアまでに実質収入が3分の1になる想定で、
 * **誰が試算しても破綻する＝シナリオとして情報を持たない**状態だった。
 */
export interface RealScenarioAssumption {
  key: ScenarioKey;
  label: string;
  /** 投資の実質利回り（年率%）。全世界株式の長期実績は実質5%前後 */
  realReturnPct: number;
  /** 実質昇給率（年率%）。マイナスは実質賃金の下落 */
  realRaisePct: number;
  /** インフレ率（年率%）。**退職金の目減りに引き続き必要**（§5.1.1 で名目固定のため） */
  inflationPct: number;
  /** 年金のマクロ経済スライド幅（%ポイント）。従来どおり */
  pensionSlidePct: number;
}

export const REAL_SCENARIOS: readonly RealScenarioAssumption[] = [
  { key: "optimistic", label: "楽観", realReturnPct: 5, realRaisePct: 1, inflationPct: 1, pensionSlidePct: 0 },
  { key: "baseline", label: "普通", realReturnPct: 3, realRaisePct: 0, inflationPct: 2, pensionSlidePct: 0.5 },
  { key: "pessimistic", label: "悲観", realReturnPct: 1, realRaisePct: -1, inflationPct: 3, pensionSlidePct: 1.0 },
];

/** 実質率とインフレ率から名目率を求める。(1+実質)×(1+インフレ)-1 */
function toNominalPct(realPct: number, inflationPct: number): number {
  return ((1 + realPct / 100) * (1 + inflationPct / 100) - 1) * 100;
}

/**
 * 計算エンジンに渡す名目ベースの前提。
 *
 * **エンジン（src/lib/lifeplan/cashflow.ts）の計算仕様は変えない。**
 * 名目で計算し、表示の直前に src/lib/lifeplan/realTerms.ts で実質へ戻す。
 * この2段構えにより、163テストが守っている計算仕様に触れずに表示単位を変えられる
 */
export const SCENARIOS: readonly ScenarioAssumption[] = REAL_SCENARIOS.map((s) => ({
  key: s.key,
  label: s.label,
  returnPct: toNominalPct(s.realReturnPct, s.inflationPct),
  raisePct: toNominalPct(s.realRaisePct, s.inflationPct),
  inflationPct: s.inflationPct,
  pensionSlidePct: s.pensionSlidePct,
}));
```

`ScenarioKey` が未 import なら `@/lib/lifeplan/types` から追加する。

- [ ] **Step 4: 成功を確認する**

Run: `npm test`
Expected: 全件 PASS。

⚠️ **既存の cashflow / scenarios のテストが落ちたら、そこで止まって報告すること。**
シナリオ定数を直接参照して具体的な金額を期待しているテストがあれば、
**期待値を暗算で書き換えないこと**（このプロジェクトでは、暗算で決めたフィクスチャが
実際には79歳で枯渇していた事故が起きている）。落ちたテストの内容を報告に含める。

- [ ] **Step 5: コミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/constants/lifeplan.ts src/constants/lifeplan.test.ts
git commit -m "feat: シナリオ前提を実質で持ち、悲観の実質昇給を-1%に是正"
```

---

### Task 3: 表示を実質にする

**Files:**
- Modify: `src/components/Simulator.tsx`
- Modify: `src/components/DepletionVerdict.tsx`
- Modify: `src/components/CashflowChart.tsx`
- Modify: `src/components/Simulator.test.tsx`

**Interfaces:**
- Consumes: `toRealTerms`（Task 1）、`REAL_SCENARIOS`（Task 2）
- Produces: なし

- [ ] **Step 1: 変換を Simulator に入れる**

`src/components/Simulator.tsx` の `result` を求めている箇所を変更する。

```tsx
import { REAL_SCENARIOS } from "@/constants/lifeplan";
import { toRealTerms } from "@/lib/lifeplan/realTerms";
```

```tsx
  // 入力が変わったときだけ再計算する。
  // エンジンは名目で計算し、ここで「今日の購買力」に直してから表示に渡す
  // （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6.2）。
  // シナリオごとにインフレ率が違うため、名目のままでは3つの数字が
  // それぞれ違う購買力の「円」になり、並べて比較できない
  const result = useMemo(() => {
    const nominal = runAllScenarios(sheet);
    return {
      ...nominal,
      scenarios: nominal.scenarios.map((s) => {
        const assumption = REAL_SCENARIOS.find((r) => r.key === s.key);
        // 見つからないことは無いが、見つからなければ変換せずそのまま返す
        // （名目のまま表示される方が、0で割って壊れるより安全）
        return assumption ? toRealTerms(s, assumption.inflationPct) : s;
      }),
    };
  }, [sheet]);
```

- [ ] **Step 2: 判定カードの表示を直す**

`src/components/DepletionVerdict.tsx` の95歳時点の行を変更する。

変更前:

```tsx
            <div className="mt-1 text-xs text-slate-500">
              95歳時点 {formatCompactYen(s.finalTotal)}
            </div>
```

変更後:

```tsx
            {/*
              95歳時点の残高は補助情報。主役は上の「◯歳で尽きる」。
              意味のない桁の名目額を大きく出すと、かえって信頼性を削る
              （docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §4.6.4）
            */}
            <div className="mt-1 text-xs text-slate-400">
              95歳時点 {formatCompactYen(s.finalTotal)}
              <span className="ml-1">（今日のお金で）</span>
            </div>
```

- [ ] **Step 3: グラフに単位を明示する**

`src/components/CashflowChart.tsx` の `ariaLabel` を変更する。

変更前:

```tsx
  const ariaLabel = `資産推移グラフ。${result.scenarios
    .map((s) => `${s.label}シナリオは${describeDepletion(s)}`)
    .join("、")}。`;
```

変更後:

```tsx
  const ariaLabel = `資産推移グラフ。金額は今日の購買力に換算した実質値。${result.scenarios
    .map((s) => `${s.label}シナリオは${describeDepletion(s)}`)
    .join("、")}。`;
```

- [ ] **Step 4: 画面下部の前提の説明を書き換える**

`src/components/Simulator.tsx` の末尾にある説明文を変更する。

変更前:

```tsx
          楽観＝利回り5%・昇給2%・インフレ1% ／ 普通＝3.5%・1%・2% ／
          悲観＝2%・0%・3%。95歳までを試算しています。
          この結果は特定の金融商品を推奨するものではありません。
```

変更後:

```tsx
          <strong>金額はすべて今日の購買力に換算しています。</strong>
          将来の物価上昇分を差し引いた「実質」の値です。
          楽観＝実質利回り5%・実質昇給+1% ／ 普通＝3%・0% ／ 悲観＝1%・-1%。
          95歳までを試算しています。
          この結果は特定の金融商品を推奨するものではありません。
```

- [ ] **Step 5: 表示が実質になったことを検証するテストを追加する**

`src/components/Simulator.test.tsx` の末尾に追記:

```tsx
describe("実質表示", () => {
  it("前提の説明に「今日の購買力」と実質の率が出る", async () => {
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
    expect(await screen.findByText(/今日の購買力に換算/)).toBeInTheDocument();
    expect(screen.getByText(/実質利回り5%/)).toBeInTheDocument();
  });

  it("95歳時点の額に「今日のお金で」が添えられる", async () => {
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
    expect((await screen.findAllByText("（今日のお金で）")).length).toBe(3);
  });
});
```

- [ ] **Step 6: 成功を確認してコミットする**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/Simulator.tsx src/components/DepletionVerdict.tsx src/components/CashflowChart.tsx src/components/Simulator.test.tsx
git commit -m "feat: 試算結果を今日の購買力で表示する"
```

---

## Self-Review

**1. 仕様カバレッジ（設計書 §4.6 との突き合わせ）**

| 設計書 | 対応するタスク |
|---|---|
| §4.6.2 実質表示・エンジンを変更しない | Task 1・Task 3 Step 1 |
| §4.6.2 枯渇年齢が不変であること | Task 1 のテスト（「主指標は不変」） |
| §4.6.3 シナリオ定数の再設定（実質5/3/1、昇給+1/0/-1） | Task 2 |
| §4.6.3 インフレ率と年金スライドは維持 | Task 2 のテスト |
| §4.6.4 95歳時点を補助情報に落とす | Task 3 Step 2 |
| §4.6.4 実質であることを明示 | Task 3 Step 2・3・4 |
| §4.6.5 モンテカルロはやらない | 全タスク（実装しない） |

**gap なし。**

**2. プレースホルダ走査**

「TBD」「適切に」「同様に」は無し。全ステップに実際のコードを記載済み。

**3. 型の整合**

- `deflate(nominalYen, inflationPct, yearsElapsed): number` は Task 1 の定義と
  `toRealTerms` 内の使用箇所で一致
- `toRealTerms(scenario, inflationPct): ScenarioResult` は Task 1 の定義と
  Task 3 Step 1 の呼び出しで一致
- `REAL_SCENARIOS` の要素が持つ `key` / `inflationPct` は Task 2 の
  `RealScenarioAssumption` の定義と Task 3 Step 1 の参照で一致
- `SCENARIOS` の型 `ScenarioAssumption` は変更しない（エンジンの入力型が不変）

**4. リスクと既存への影響**

- **`src/lib/lifeplan/cashflow.ts` を触らないので、163テストの計算仕様は不変**
- `SCENARIOS` の**値**が変わるため、定数を参照して金額を期待している既存テストが
  落ちる可能性がある。Task 2 Step 4 に「暗算で期待値を書き換えず報告する」旨を明記済み
- `depletionAge` が変わらないことは Task 1 のテストで固定した。ただし
  **`SCENARIOS` の値が変わることで枯渇年齢そのものは変わる**（別の話）。
  これは意図した変更（悲観が破滅しなくなる）
