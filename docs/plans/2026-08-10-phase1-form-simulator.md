# Phase 1: フォームベース ライフプランシミュレーター 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ヒアリング項目をフォームで入力し、将来の資産推移を楽観／普通／悲観の3シナリオで可視化して「資産が何歳で尽きるか」を判定する、サーバー不要のWebアプリを作る。

**Architecture:** Next.js を静的エクスポート（`output: "export"`）し、Cloudflare Workers の Static Assets で配信する。計算はすべてUI非依存の純粋関数としてブラウザ内で実行し、サーバーもAPIキーも持たない。入力は localStorage に保存する。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind CSS v4 / recharts / Vitest / Wrangler

**このPhaseの位置づけ:** AIヒアリング層（Phase 2）を載せる前の土台であると同時に、**それ自体で完成品**として出荷できる。フォーム入力はチャットより速く正確という調査結果があるため、Phase 2 導入後もフォールバック兼A/Bの対照群として残す。

## Global Constraints

- 仕様は `docs/requirements.md` が唯一の情報源。数値や挙動で迷ったら必ず参照する
- **金額はすべて円（number）、率はすべてパーセント（number）** で扱う。`5%` は `5`、`0.05` ではない
- **寿命は95歳固定。** 入力項目にしない
- **貯金には利回りを適用しない。** 貯金と投資を1本にまとめない
- 計算ロジックは `src/lib/` 配下の純粋関数として書き、React に依存させない
- テストは実装ファイルと同じディレクトリに `*.test.ts` として置く（`src/**/*.test.ts` が Vitest の対象）
- ドキュメントコメントとテストの説明文は**日本語**で書く（既存プロジェクト `nisa-simulation` の規約）
- 数値リテラルは桁区切りを使う（`366_599`）
- パスエイリアス `@/` は `src/` を指す
- **Phase 1 ではサーバーサイドのコードを一切書かない。** `src/app/api/` を作らない

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/lib/lifeplan/types.ts` | ヒアリングシート・年次行・シナリオ結果の型定義 |
| `src/constants/lifeplan.ts` | 寿命・3シナリオの前提値・教育費テーブル。**制度や統計が変わったらここだけ直す** |
| `src/lib/lifeplan/education.ts` | 子供の年齢と進路から教育費イベントを生成 |
| `src/lib/lifeplan/cashflow.ts` | 1シナリオぶんの年次ループ本体 |
| `src/lib/lifeplan/scenarios.ts` | 3シナリオ実行と枯渇判定の集約 |
| `src/lib/format.ts` | 金額の表示整形（万円・億円） |
| `src/lib/storage.ts` | localStorage への保存と復元 |
| `src/components/HearingForm.tsx` | Tier 1 / Tier 2 の入力フォーム |
| `src/components/DerivedSummary.tsx` | 導出値（年間収支）の表示 |
| `src/components/CashflowChart.tsx` | 3シナリオ重ね描きグラフ |
| `src/components/DepletionVerdict.tsx` | 「資産が尽きる年」の判定表示 |
| `src/components/Simulator.tsx` | 状態管理と全体の組み立て |
| `src/app/page.tsx` | トップページ |
| `src/app/privacy/page.tsx` | プライバシーポリシー |

---

### Task 1: プロジェクト初期化

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.mts`, `postcss.config.mjs`, `eslint.config.mjs`, `wrangler.jsonc`, `.gitignore`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Test: `src/lib/smoke.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `npm test` / `npm run build` / `npm run typecheck` が動く状態

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "lifeplan-simulator",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "next build && wrangler deploy",
    "preview": "next build && wrangler dev"
  },
  "dependencies": {
    "next": "16.2.12",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "recharts": "^3.10.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.12",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^4.1.10",
    "wrangler": "^4.114.0"
  }
}
```

- [ ] **Step 2: 設定ファイル群を作成**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 全ページSSGのため静的エクスポートし、Cloudflare Workers (Static Assets) で配信する
  output: "export",
};

export default nextConfig;
```

`vitest.config.mts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

> ⚠️ **拡張子は `.mts`、パス解決は `import.meta.dirname`。両方セットで意味がある。**
> `.ts` のままだと Vite の `configLoader: 'native'` が ESM 構文を CommonJS として
> 読み込もうとして警告を出す。かといって `.mts` にするだけだと、今度は ESM に存在しない
> `__dirname` が警告対象になる。`package.json` に `"type": "module"` を足す解法は
> Next.js 側の設定読み込みに影響しうるので採らない。
> `import.meta.dirname` は Node 20.11 以上が必要。

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`postcss.config.mjs`:
```js
const config = {
  plugins: ["@tailwindcss/postcss"],
};

export default config;
```

`eslint.config.mjs`:
```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [...compat.extends("next/core-web-vitals", "next/typescript")];
```

`wrangler.jsonc`:
```jsonc
// Cloudflare Workers (Static Assets) の設定
// デプロイ: npm run deploy（要 `wrangler login` または CLOUDFLARE_API_TOKEN）
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "lifeplan-simulator",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./out",
    "not_found_handling": "404-page"
  }
}
```

`.gitignore`:
```
node_modules/
.next/
out/
.wrangler/
next-env.d.ts
*.tsbuildinfo
.env*
.dev.vars
.DS_Store
.superpowers/
```

- [ ] **Step 3: 最小のアプリシェルを作成**

`src/app/globals.css`:
```css
@import "tailwindcss";
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ライフプランシミュレーター",
  description:
    "年齢・家族構成・収支から将来の資産推移を3シナリオで試算し、資産が何歳で尽きるかを可視化します。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-8">ライフプランシミュレーター</main>;
}
```

- [ ] **Step 4: スモークテストを書く**

`src/lib/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("テスト環境", () => {
  it("Vitest が動作する", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 依存をインストールして各コマンドが通ることを確認**

```bash
npm install
npm test
npm run typecheck
npm run build
```

期待: `npm test` が 1 passed、`npm run typecheck` がエラーなし、`npm run build` が `out/` を生成して成功。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "chore: Next.js 静的エクスポート + Vitest のプロジェクト基盤を作成"
```

---

### Task 2: 型定義とドメイン定数

**Files:**
- Create: `src/lib/lifeplan/types.ts`, `src/constants/lifeplan.ts`
- Test: `src/constants/lifeplan.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - 型 `Occupation`, `EducationPath`, `EducationStage`, `Child`, `LifeEvent`, `HearingSheet`, `ScenarioKey`, `ScenarioAssumption`, `YearRow`, `ScenarioResult`, `LifeplanResult`
  - 定数 `LIFE_EXPECTANCY_AGE: number`, `DEFAULT_PENSION_START_AGE: number`, `SCENARIOS: readonly ScenarioAssumption[]`, `EDUCATION_STAGES: readonly {...}[]`, `EDUCATION_ANNUAL_COST`, `UNIVERSITY_ENTRANCE_FEE`

- [ ] **Step 1: 型定義を書く**

`src/lib/lifeplan/types.ts`:
```ts
/**
 * 職業。
 *
 * ⚠️ Phase 1 の計算では使わない。それでも Tier 1 の必須項目として持つのは、
 * localStorage に保存するスキーマを Phase 2（AIヒアリング）で変えずに済ませるため。
 * Phase 2 では会話の分岐（自営業なら生活防衛資金を1年分で聞く等）に使う。
 * 保存キーを v1 のまま保てることを優先した意図的な前倒し（docs/requirements.md §4）
 */
export type Occupation = "employee" | "civil_servant" | "self_employed" | "other";

/** 子供の進路。教育費テーブルの参照キー */
export type EducationPath = "public" | "private";

/** 進学段階 */
export type EducationStage = "kindergarten" | "elementary" | "junior" | "high" | "university";

/** 子供1人ぶんの情報 */
export interface Child {
  /** 現在年齢（0〜22） */
  age: number;
  /** 進路。全段階に一律で適用する */
  path: EducationPath;
}

/** 特定の年に発生する一時的な支出 */
export interface LifeEvent {
  /** 本人（シミュレーション主体）が何歳のときに発生するか */
  age: number;
  /** 金額（円）。支出は正の数で表す */
  amount: number;
  /** 表示用ラベル。例: "長子 小学校" */
  label: string;
}

/**
 * ヒアリングシート。金額はすべて円、率はすべて%。
 * Tier 1 は必須、Tier 2 は省略可（docs/requirements.md §4）
 */
export interface HearingSheet {
  // --- Tier 1（必須） ---
  /** 現在の年齢 */
  currentAge: number;
  /** 職業 */
  occupation: Occupation;
  /** 世帯手取り年収（円）。配偶者がいれば合算 */
  householdNetIncome: number;
  /** 年間の基本生活費（円） */
  annualLivingCost: number;
  /** 現在の貯金（円）。利回りは適用されない */
  savings: number;
  /** 現在の投資額（円）。利回りが適用される */
  investments: number;
  /** リタイア予定年齢 */
  retirementAge: number;

  // --- Tier 2（任意） ---
  /** 子供。教育費イベントが自動生成される */
  children?: Child[];
  /** 退職金（円）。リタイアした年に一度だけ加算される */
  retirementLumpSum?: number;
  /** 年金の年額（円） */
  pensionAnnual?: number;
  /** 年金受給開始年齢。省略時は DEFAULT_PENSION_START_AGE */
  pensionStartAge?: number;
  /** 住宅購入などの任意イベント */
  customEvents?: LifeEvent[];
}

/** シナリオの識別子 */
export type ScenarioKey = "optimistic" | "baseline" | "pessimistic";

/** シナリオごとの前提値（docs/requirements.md §5.2） */
export interface ScenarioAssumption {
  key: ScenarioKey;
  /** 表示名 */
  label: string;
  /** 投資の想定利回り（年率%） */
  returnPct: number;
  /** 昇給率（年率%） */
  raisePct: number;
  /** インフレ率（年率%） */
  inflationPct: number;
}

/** 1年ぶんの計算結果 */
export interface YearRow {
  /** その年の年齢 */
  age: number;
  /** 年間収入（円） */
  income: number;
  /** 年間支出（円） */
  expense: number;
  /** 収支 = 収入 - 支出（円） */
  balance: number;
  /** 年末の貯金残高（円） */
  savings: number;
  /** 年末の投資残高（円） */
  investments: number;
  /** 年末の総資産 = 貯金 + 投資（円） */
  total: number;
  /** その年に発生したイベントのラベル */
  events: string[];
}

/** 1シナリオぶんの結果 */
export interface ScenarioResult {
  key: ScenarioKey;
  label: string;
  /** 現在年齢から95歳までの各年 */
  rows: YearRow[];
  /** 総資産が初めてマイナスになる年齢。最後まで尽きなければ null */
  depletionAge: number | null;
  /** 95歳時点の総資産（円） */
  finalTotal: number;
}

/** 全シナリオの結果 */
export interface LifeplanResult {
  scenarios: ScenarioResult[];
  /** すべてのシナリオで資産が尽きなければ true */
  survivesAllScenarios: boolean;
}
```

- [ ] **Step 2: 定数を書く**

`src/constants/lifeplan.ts`:
```ts
import type { EducationPath, EducationStage, ScenarioAssumption } from "@/lib/lifeplan/types";

/**
 * 試算の終了年齢。
 * 「足りなくなる年を先に見つける」のが目的なので長めに置く（docs/requirements.md §5.1）
 */
export const LIFE_EXPECTANCY_AGE = 95;

/** 年金受給開始年齢の既定値 */
export const DEFAULT_PENSION_START_AGE = 65;

/**
 * 3シナリオの前提値（docs/requirements.md §5.2）。
 * 利回りだけでなく昇給率・インフレ率も連動させる。
 * 悲観シナリオでも破綻しないなら、その計画は強いと判定できる
 */
export const SCENARIOS: readonly ScenarioAssumption[] = [
  { key: "optimistic", label: "楽観", returnPct: 5, raisePct: 2, inflationPct: 1 },
  { key: "baseline", label: "普通", returnPct: 3.5, raisePct: 1, inflationPct: 2 },
  { key: "pessimistic", label: "悲観", returnPct: 2, raisePct: 0, inflationPct: 3 },
] as const;

/** 進学段階の定義。子供の年齢 startAge〜endAge（両端を含む）がその段階にあたる */
export const EDUCATION_STAGES: readonly {
  stage: EducationStage;
  label: string;
  startAge: number;
  endAge: number;
}[] = [
  { stage: "kindergarten", label: "幼稚園", startAge: 3, endAge: 5 },
  { stage: "elementary", label: "小学校", startAge: 6, endAge: 11 },
  { stage: "junior", label: "中学校", startAge: 12, endAge: 14 },
  { stage: "high", label: "高校", startAge: 15, endAge: 17 },
  { stage: "university", label: "大学", startAge: 18, endAge: 21 },
] as const;

/**
 * 進学段階ごとの「子供1人あたり年間教育費」（円）。
 *
 * 幼稚園〜高校: 文部科学省「令和5年度 子供の学習費調査」の**学習費総額**
 *   （学校教育費 + 学校給食費 + 学校外活動費）。
 *   出典: https://www.mext.go.jp/b_menu/toukei/chousa03/gakushuuhi/kekka/k_detail/mext_00002.html
 *
 *   ⚠️ この数値は **2026年1月16日公表の訂正版**。2024年12月の初回公表値
 *   （私立小 1,828,112 円など）がネット上に多数残っているが、そちらは誤り。
 *   出典の正誤情報: https://www.mext.go.jp/b_menu/toukei/chousa03/gakushuuhi/seigo_001.html
 *
 *   ⚠️ 高校の値は令和5年度時点のもので、2025年4月からの授業料支援拡充は反映していない。
 *   実際の負担はこれより小さくなる可能性がある（保守側に振れるので当面はこのまま使う）。
 *
 * 大学: public = 国立大学の標準額（授業料 535,800円/年）。
 *   private = 私立大学 文科系の2年目以降相当（授業料 + 施設設備費 + 実験実習料等）。
 *   出典: 文部科学省「令和7年度 私立大学等入学者に係る学生納付金等調査」
 *   https://www.mext.go.jp/a_menu/koutou/shinkou/07021403/1412031_00006.htm
 *
 *   ⚠️ 国立の額は国が示す**標準額**であり、各大学が独自に増額できる。
 */
export const EDUCATION_ANNUAL_COST: Record<EducationPath, Record<EducationStage, number>> = {
  public: {
    kindergarten: 184_646,
    elementary: 366_599,
    junior: 542_450,
    high: 596_954,
    university: 535_800,
  },
  private: {
    kindergarten: 347_338,
    elementary: 1_741_516,
    junior: 1_560_359,
    high: 1_179_261,
    university: 1_080_610,
  },
};

/**
 * 大学の入学料（円）。入学した年に一度だけ発生する。
 * public = 国立の標準額 282,000円 / private = 私立文科系の平均 219,951円（出典は上と同じ）
 */
export const UNIVERSITY_ENTRANCE_FEE: Record<EducationPath, number> = {
  public: 282_000,
  private: 219_951,
};
```

- [ ] **Step 3: 定数の整合テストを書く**

`src/constants/lifeplan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
  SCENARIOS,
  UNIVERSITY_ENTRANCE_FEE,
} from "./lifeplan";

describe("ライフプラン定数", () => {
  it("3シナリオが楽観・普通・悲観の順に揃っている", () => {
    expect(SCENARIOS.map((s) => s.key)).toEqual([
      "optimistic",
      "baseline",
      "pessimistic",
    ]);
  });

  it("利回りは楽観 > 普通 > 悲観、インフレ率は逆順になっている", () => {
    const [opt, base, pes] = SCENARIOS;
    expect(opt.returnPct).toBeGreaterThan(base.returnPct);
    expect(base.returnPct).toBeGreaterThan(pes.returnPct);
    expect(opt.inflationPct).toBeLessThan(base.inflationPct);
    expect(base.inflationPct).toBeLessThan(pes.inflationPct);
  });

  it("教育費テーブルが全段階ぶん揃っている", () => {
    for (const path of ["public", "private"] as const) {
      for (const { stage } of EDUCATION_STAGES) {
        expect(EDUCATION_ANNUAL_COST[path][stage]).toBeGreaterThan(0);
      }
    }
  });

  it("私立はどの段階でも公立より高い", () => {
    for (const { stage } of EDUCATION_STAGES) {
      expect(EDUCATION_ANNUAL_COST.private[stage]).toBeGreaterThan(
        EDUCATION_ANNUAL_COST.public[stage],
      );
    }
  });

  it("進学段階が年齢の重複なく連続している", () => {
    for (let i = 1; i < EDUCATION_STAGES.length; i++) {
      expect(EDUCATION_STAGES[i].startAge).toBe(EDUCATION_STAGES[i - 1].endAge + 1);
    }
  });

  it("大学の入学料が両方の進路で設定されている", () => {
    expect(UNIVERSITY_ENTRANCE_FEE.public).toBeGreaterThan(0);
    expect(UNIVERSITY_ENTRANCE_FEE.private).toBeGreaterThan(0);
  });

  it("試算終了年齢は95歳", () => {
    expect(LIFE_EXPECTANCY_AGE).toBe(95);
  });
});
```

- [ ] **Step 4: Task 1 のスモークテストを削除する**

`src/lib/smoke.test.ts` は Vitest が動くことを確認するためだけの足場だった。
このタスクで実データを検証する本物のテストが入るので、役目を終えた足場は消す。

```bash
rm src/lib/smoke.test.ts
```

- [ ] **Step 5: テストを実行**

```bash
npm test
```

期待: 7 passed（スモークテストは消えているので、この7件がすべて）

- [ ] **Step 6: コミット**

```bash
git rm --cached src/lib/smoke.test.ts 2>/dev/null || true
git add -A src/lib/lifeplan/types.ts src/constants/lifeplan.ts src/constants/lifeplan.test.ts src/lib/
git commit -m "feat: ライフプランの型定義とドメイン定数を追加

教育費は文科省「令和5年度 子供の学習費調査」の2026-01-16訂正版を使用。
初回公表値がネット上に多く残っているが誤りのため注意。"
```

---

### Task 3: 教育費イベントの生成

**Files:**
- Create: `src/lib/lifeplan/education.ts`
- Test: `src/lib/lifeplan/education.test.ts`

**Interfaces:**
- Consumes: `Child`, `LifeEvent`（Task 2）、`EDUCATION_STAGES`, `EDUCATION_ANNUAL_COST`, `UNIVERSITY_ENTRANCE_FEE`, `LIFE_EXPECTANCY_AGE`（Task 2）
- Produces: `buildEducationEvents(children: Child[] | undefined, parentCurrentAge: number): LifeEvent[]`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lifeplan/education.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { EDUCATION_ANNUAL_COST, UNIVERSITY_ENTRANCE_FEE } from "@/constants/lifeplan";
import { buildEducationEvents } from "./education";

describe("buildEducationEvents", () => {
  it("子供がいなければ空配列を返す", () => {
    expect(buildEducationEvents(undefined, 40)).toEqual([]);
    expect(buildEducationEvents([], 40)).toEqual([]);
  });

  it("6歳の子（公立）は小学校6年ぶんのイベントを親40〜45歳に生成する", () => {
    const events = buildEducationEvents([{ age: 6, path: "public" }], 40);
    const elementary = events.filter((e) => e.label.includes("小学校"));
    expect(elementary).toHaveLength(6);
    expect(elementary.map((e) => e.age)).toEqual([40, 41, 42, 43, 44, 45]);
    expect(elementary[0].amount).toBe(EDUCATION_ANNUAL_COST.public.elementary);
  });

  it("すでに22歳の子はイベントを生成しない", () => {
    expect(buildEducationEvents([{ age: 22, path: "private" }], 50)).toEqual([]);
  });

  it("過去の学齢ぶんは生成せず、これからの分だけを生成する", () => {
    // 16歳の子 → 高校2年ぶん（16,17歳）と大学4年ぶんだけが残っている
    const events = buildEducationEvents([{ age: 16, path: "public" }], 45);
    expect(events.filter((e) => e.label.includes("小学校"))).toHaveLength(0);
    expect(events.filter((e) => e.label.includes("高校"))).toHaveLength(2);
  });

  it("大学入学年には入学料が別イベントとして加算される", () => {
    const events = buildEducationEvents([{ age: 18, path: "private" }], 50);
    const entrance = events.filter((e) => e.label.includes("入学料"));
    expect(entrance).toHaveLength(1);
    expect(entrance[0].age).toBe(50);
    expect(entrance[0].amount).toBe(UNIVERSITY_ENTRANCE_FEE.private);
  });

  it("大学入学前から始めれば入学料も含まれる", () => {
    const events = buildEducationEvents([{ age: 10, path: "public" }], 40);
    expect(events.filter((e) => e.label.includes("入学料"))).toHaveLength(1);
  });

  it("複数の子供はラベルで区別される", () => {
    const events = buildEducationEvents(
      [
        { age: 6, path: "public" },
        { age: 9, path: "public" },
      ],
      40,
    );
    expect(events.some((e) => e.label.startsWith("第1子"))).toBe(true);
    expect(events.some((e) => e.label.startsWith("第2子"))).toBe(true);
  });

  it("私立は公立より総額が大きい", () => {
    const pub = buildEducationEvents([{ age: 0, path: "public" }], 30);
    const pri = buildEducationEvents([{ age: 0, path: "private" }], 30);
    const sum = (es: { amount: number }[]) => es.reduce((s, e) => s + e.amount, 0);
    expect(sum(pri)).toBeGreaterThan(sum(pub));
  });

  it("親が95歳を超える年のイベントは生成しない", () => {
    // 0歳の子・親90歳 → 幼稚園は親93〜95歳、小学校以降は96歳以上で範囲外
    const events = buildEducationEvents([{ age: 0, path: "public" }], 90);
    expect(events.every((e) => e.age <= 95)).toBe(true);
    expect(events.filter((e) => e.label.includes("小学校"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/lifeplan/education.test.ts
```

期待: FAIL（`buildEducationEvents` が存在しないためインポートエラー）

- [ ] **Step 3: 実装を書く**

`src/lib/lifeplan/education.ts`:
```ts
import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
  UNIVERSITY_ENTRANCE_FEE,
} from "@/constants/lifeplan";
import type { Child, LifeEvent } from "./types";

/**
 * 子供の現在年齢と進路から、これから発生する教育費イベントを生成する。
 *
 * 仕様（docs/requirements.md §4）:
 * - 子供の年齢を1歳ずつ進め、その年齢が進学段階に該当すれば1年ぶんの費用を計上する
 * - 費用が発生するのは「本人（親）が何歳のときか」に変換して記録する
 * - すでに過ぎた学齢は計上しない（現在年齢より前には遡らない）
 * - 大学の入学料は入学年に一度だけ、別イベントとして加算する
 * - 試算範囲（95歳）を超える年のイベントは捨てる
 */
export function buildEducationEvents(
  children: Child[] | undefined,
  parentCurrentAge: number,
): LifeEvent[] {
  if (!children || children.length === 0) return [];

  const events: LifeEvent[] = [];

  children.forEach((child, index) => {
    // 子供が複数いるときにグラフ上で区別できるようにする
    const who = `第${index + 1}子`;

    for (const { stage, label, startAge, endAge } of EDUCATION_STAGES) {
      for (let childAge = startAge; childAge <= endAge; childAge++) {
        // すでに過ぎた学齢は計上しない
        if (childAge < child.age) continue;

        // 子供がその年齢になるとき、親は何歳か
        const parentAge = parentCurrentAge + (childAge - child.age);
        if (parentAge > LIFE_EXPECTANCY_AGE) continue;

        events.push({
          age: parentAge,
          amount: EDUCATION_ANNUAL_COST[child.path][stage],
          label: `${who} ${label}`,
        });

        // 大学は入学年に入学料が別途かかる
        if (stage === "university" && childAge === startAge) {
          events.push({
            age: parentAge,
            amount: UNIVERSITY_ENTRANCE_FEE[child.path],
            label: `${who} 大学入学料`,
          });
        }
      }
    }
  });

  return events;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/lifeplan/education.test.ts
```

期待: 9 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/lifeplan/education.ts src/lib/lifeplan/education.test.ts
git commit -m "feat: 子供の年齢と進路から教育費イベントを生成する"
```

---

### Task 4: 年次キャッシュフロー計算

**Files:**
- Create: `src/lib/lifeplan/cashflow.ts`
- Test: `src/lib/lifeplan/cashflow.test.ts`

**Interfaces:**
- Consumes: `HearingSheet`, `ScenarioAssumption`, `ScenarioResult`, `YearRow`（Task 2）、`buildEducationEvents`（Task 3）、`LIFE_EXPECTANCY_AGE`, `DEFAULT_PENSION_START_AGE`（Task 2）
- Produces: `simulateCashflow(sheet: HearingSheet, assumption: ScenarioAssumption): ScenarioResult`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lifeplan/cashflow.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { simulateCashflow } from "./cashflow";
import type { HearingSheet, ScenarioAssumption } from "./types";

/** 率をすべて0にした前提。複利やインフレを排して単純な足し引きだけを検証する */
const FLAT: ScenarioAssumption = {
  key: "baseline",
  label: "検証用",
  returnPct: 0,
  raisePct: 0,
  inflationPct: 0,
};

/** 黒字が出る標準的なシート。年収600万・生活費400万 → 年200万の黒字 */
const BASE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 4_000_000,
  savings: 3_000_000,
  investments: 5_000_000,
  retirementAge: 65,
};

describe("simulateCashflow", () => {
  it("現在年齢から95歳までの行を生成する", () => {
    const result = simulateCashflow(BASE, FLAT);
    expect(result.rows).toHaveLength(LIFE_EXPECTANCY_AGE - BASE.currentAge + 1);
    expect(result.rows[0].age).toBe(40);
    expect(result.rows.at(-1)!.age).toBe(LIFE_EXPECTANCY_AGE);
  });

  it("黒字の年は投資が増え、貯金は変わらない", () => {
    const result = simulateCashflow(BASE, FLAT);
    const first = result.rows[0];
    expect(first.balance).toBe(2_000_000);
    expect(first.investments).toBe(7_000_000); // 500万 + 黒字200万
    expect(first.savings).toBe(3_000_000); // 変わらない
  });

  it("貯金には利回りがつかず、投資にだけつく", () => {
    // 収支ゼロにして運用の効果だけを見る
    const sheet: HearingSheet = {
      ...BASE,
      householdNetIncome: 4_000_000,
      annualLivingCost: 4_000_000,
    };
    const result = simulateCashflow(sheet, { ...FLAT, returnPct: 10 });
    const first = result.rows[0];
    expect(first.savings).toBe(3_000_000); // 貯金は増えない
    expect(first.investments).toBe(5_500_000); // 500万 × 1.10
  });

  it("赤字の年はまず貯金から取り崩す", () => {
    // 生活費が年収を100万上回る
    const sheet: HearingSheet = { ...BASE, annualLivingCost: 7_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    const first = result.rows[0];
    expect(first.balance).toBe(-1_000_000);
    expect(first.savings).toBe(2_000_000); // 300万 - 100万
    expect(first.investments).toBe(5_000_000); // 手を付けない
  });

  it("貯金が尽きたら投資を取り崩す", () => {
    // 年400万の赤字 → 1年目で貯金300万を使い切り、残り100万を投資から
    const sheet: HearingSheet = { ...BASE, annualLivingCost: 10_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    const first = result.rows[0];
    expect(first.savings).toBe(0);
    expect(first.investments).toBe(4_000_000); // 500万 - 100万
  });

  it("リタイア年齢以降は給与がゼロになる", () => {
    const result = simulateCashflow(BASE, FLAT);
    const atRetirement = result.rows.find((r) => r.age === BASE.retirementAge)!;
    expect(atRetirement.income).toBe(0);
    const beforeRetirement = result.rows.find((r) => r.age === BASE.retirementAge - 1)!;
    expect(beforeRetirement.income).toBe(BASE.householdNetIncome);
  });

  it("退職金はリタイアした年に一度だけ加算される", () => {
    const sheet: HearingSheet = { ...BASE, retirementLumpSum: 20_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    expect(result.rows.find((r) => r.age === 65)!.income).toBe(20_000_000);
    expect(result.rows.find((r) => r.age === 66)!.income).toBe(0);
  });

  it("年金は受給開始年齢から毎年入る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      pensionAnnual: 2_000_000,
      pensionStartAge: 65,
    };
    const result = simulateCashflow(sheet, FLAT);
    expect(result.rows.find((r) => r.age === 64)!.income).toBe(BASE.householdNetIncome);
    expect(result.rows.find((r) => r.age === 65)!.income).toBe(2_000_000);
    expect(result.rows.find((r) => r.age === 80)!.income).toBe(2_000_000);
  });

  it("年金受給開始年齢を省略すると65歳から始まる", () => {
    const sheet: HearingSheet = { ...BASE, pensionAnnual: 2_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    expect(result.rows.find((r) => r.age === 64)!.income).toBe(BASE.householdNetIncome);
    expect(result.rows.find((r) => r.age === 65)!.income).toBe(2_000_000);
  });

  it("インフレ率のぶんだけ支出が毎年増える", () => {
    const result = simulateCashflow(BASE, { ...FLAT, inflationPct: 2 });
    expect(result.rows[0].expense).toBe(4_000_000);
    expect(result.rows[1].expense).toBe(Math.round(4_000_000 * 1.02));
    expect(result.rows[10].expense).toBe(Math.round(4_000_000 * 1.02 ** 10));
  });

  it("昇給率のぶんだけ給与が毎年増える", () => {
    const result = simulateCashflow(BASE, { ...FLAT, raisePct: 3 });
    expect(result.rows[0].income).toBe(6_000_000);
    expect(result.rows[5].income).toBe(Math.round(6_000_000 * 1.03 ** 5));
  });

  it("教育費イベントがその年の支出に乗り、ラベルが記録される", () => {
    const sheet: HearingSheet = { ...BASE, children: [{ age: 6, path: "public" }] };
    const result = simulateCashflow(sheet, FLAT);
    const first = result.rows[0];
    expect(first.expense).toBeGreaterThan(4_000_000);
    expect(first.events.some((e) => e.includes("小学校"))).toBe(true);
  });

  it("任意イベントもその年の支出に乗る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      customEvents: [{ age: 45, amount: 30_000_000, label: "住宅購入" }],
    };
    const result = simulateCashflow(sheet, FLAT);
    const at45 = result.rows.find((r) => r.age === 45)!;
    expect(at45.expense).toBe(4_000_000 + 30_000_000);
    expect(at45.events).toContain("住宅購入");
  });

  it("資産が尽きる年齢を記録する", () => {
    // 資産800万に対して年400万の赤字 → 2年目（41歳）の終わりに尽きる
    const sheet: HearingSheet = { ...BASE, annualLivingCost: 10_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    expect(result.depletionAge).toBe(42);
  });

  it("最後まで尽きなければ depletionAge は null", () => {
    const result = simulateCashflow(BASE, FLAT);
    expect(result.depletionAge).toBeNull();
  });

  it("枯渇後のマイナス残高には利回りを適用しない", () => {
    const sheet: HearingSheet = { ...BASE, annualLivingCost: 10_000_000 };
    const result = simulateCashflow(sheet, { ...FLAT, returnPct: 5 });
    const rows = result.rows;
    // マイナスに落ちた後は、毎年きっかり赤字額ぶんだけ減る（複利で膨らまない）
    const negative = rows.filter((r) => r.total < 0);
    const delta = negative[1].total - negative[0].total;
    const delta2 = negative[2].total - negative[1].total;
    expect(delta2).toBe(delta);
  });

  it("最終年の総資産を finalTotal に返す", () => {
    const result = simulateCashflow(BASE, FLAT);
    expect(result.finalTotal).toBe(result.rows.at(-1)!.total);
  });

  it("シナリオの識別子とラベルをそのまま引き継ぐ", () => {
    const result = simulateCashflow(BASE, FLAT);
    expect(result.key).toBe("baseline");
    expect(result.label).toBe("検証用");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/lifeplan/cashflow.test.ts
```

期待: FAIL（`simulateCashflow` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/lifeplan/cashflow.ts`:
```ts
import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { buildEducationEvents } from "./education";
import type { HearingSheet, LifeEvent, ScenarioAssumption, ScenarioResult, YearRow } from "./types";

/**
 * 1シナリオぶんの年次キャッシュフローを計算する。
 *
 * 計算仕様（docs/requirements.md §5.1）:
 *   収入 = 給与（リタイア前のみ、昇給率で毎年増える）
 *        + 年金（受給開始年齢以降）
 *        + 退職金（リタイアした年のみ）
 *   支出 = 基本生活費（インフレ率で毎年増える）+ その年のイベント費
 *   収支 = 収入 - 支出
 *
 * 資産の扱いがこの計算の要点:
 * - **貯金には利回りを適用しない。** 貯金と投資を1本にまとめて全額に利回りを掛けると
 *   資産推移を構造的に過大評価してしまう
 * - 黒字は投資に積み増す
 * - 赤字はまず貯金から取り崩し、貯金が尽きてから投資に手を付ける
 * - 資産が尽きてマイナスに落ちた後は利回りを適用しない（借金が複利で膨らむ挙動を避ける）
 */
export function simulateCashflow(
  sheet: HearingSheet,
  assumption: ScenarioAssumption,
): ScenarioResult {
  // 教育費と任意イベントをまとめ、年齢で引ける形に前処理しておく。
  // 年次ループの中で毎回配列を線形探索せずに済ませるため
  const allEvents: LifeEvent[] = [
    ...buildEducationEvents(sheet.children, sheet.currentAge),
    ...(sheet.customEvents ?? []),
  ];
  const eventsByAge = new Map<number, LifeEvent[]>();
  for (const event of allEvents) {
    const bucket = eventsByAge.get(event.age);
    if (bucket) bucket.push(event);
    else eventsByAge.set(event.age, [event]);
  }

  // %（例: 5）を小数（0.05）に変換しておく
  const returnRate = assumption.returnPct / 100;
  const raiseRate = assumption.raisePct / 100;
  const inflationRate = assumption.inflationPct / 100;
  const pensionStartAge = sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE;

  // --- ループ中に更新していく状態 ---
  let savings = sheet.savings;
  let investments = sheet.investments;
  const rows: YearRow[] = [];
  let depletionAge: number | null = null;

  for (let age = sheet.currentAge; age <= LIFE_EXPECTANCY_AGE; age++) {
    // 現在からの経過年数。昇給・インフレの累乗に使う
    const elapsed = age - sheet.currentAge;

    // --- 収入 ---
    const salary =
      age < sheet.retirementAge
        ? sheet.householdNetIncome * (1 + raiseRate) ** elapsed
        : 0;
    const pension = age >= pensionStartAge ? (sheet.pensionAnnual ?? 0) : 0;
    // 退職金はリタイアした年に一度だけ
    const lumpSum = age === sheet.retirementAge ? (sheet.retirementLumpSum ?? 0) : 0;
    const income = salary + pension + lumpSum;

    // --- 支出 ---
    const living = sheet.annualLivingCost * (1 + inflationRate) ** elapsed;
    const yearEvents = eventsByAge.get(age) ?? [];
    const eventCost = yearEvents.reduce((sum, e) => sum + e.amount, 0);
    const expense = living + eventCost;

    const balance = income - expense;

    // --- 資産の更新 ---
    // 1. 先に運用させる。マイナス残高には利回りを適用しない
    if (investments > 0) {
      investments *= 1 + returnRate;
    }

    // 2. 収支を反映する
    if (balance >= 0) {
      // 黒字は投資に回す
      investments += balance;
    } else {
      // 赤字はまず貯金から。貯金で足りなければ不足分を投資から取り崩す
      savings += balance;
      if (savings < 0) {
        investments += savings;
        savings = 0;
      }
    }

    const total = savings + investments;
    // 総資産が初めてマイナスになった年齢を記録する（記録済みなら上書きしない）
    if (depletionAge === null && total < 0) {
      depletionAge = age;
    }

    rows.push({
      age,
      income: Math.round(income),
      expense: Math.round(expense),
      balance: Math.round(balance),
      savings: Math.round(savings),
      investments: Math.round(investments),
      total: Math.round(total),
      events: yearEvents.map((e) => e.label),
    });
  }

  return {
    key: assumption.key,
    label: assumption.label,
    rows,
    depletionAge,
    finalTotal: Math.round(savings + investments),
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/lifeplan/cashflow.test.ts
```

期待: 18 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/lifeplan/cashflow.ts src/lib/lifeplan/cashflow.test.ts
git commit -m "feat: 年次キャッシュフロー計算を実装

貯金には利回りを適用せず、赤字は貯金から先に取り崩す。
枯渇後のマイナス残高も複利で膨らませない。"
```

---

### Task 5: 3シナリオの実行と集約

**Files:**
- Create: `src/lib/lifeplan/scenarios.ts`
- Test: `src/lib/lifeplan/scenarios.test.ts`

**Interfaces:**
- Consumes: `simulateCashflow`（Task 4）、`SCENARIOS`（Task 2）、`HearingSheet`, `LifeplanResult`（Task 2）
- Produces: `runAllScenarios(sheet: HearingSheet): LifeplanResult`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lifeplan/scenarios.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runAllScenarios } from "./scenarios";
import type { HearingSheet } from "./types";

/**
 * 資産が桁違いに大きく、悲観シナリオでも絶対に尽きない設定。
 *
 * 集約ロジックだけを検証したいので、財務的にぎりぎりの値は使わない。
 * 「このフィクスチャなら尽きるはず」を暗算で決めるとテストが壊れやすくなる
 */
const SAFE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 10_000_000,
  annualLivingCost: 1_000_000,
  savings: 10_000_000,
  investments: 500_000_000,
  retirementAge: 65,
  pensionAnnual: 3_000_000,
};

/** 資産ゼロ・収入より支出が桁違いに大きく、どのシナリオでも初年度から破綻する設定 */
const DOOMED: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 1_000_000,
  annualLivingCost: 20_000_000,
  savings: 0,
  investments: 0,
  retirementAge: 65,
};

describe("runAllScenarios", () => {
  it("楽観・普通・悲観の3シナリオを返す", () => {
    const result = runAllScenarios(SAFE);
    expect(result.scenarios).toHaveLength(3);
    expect(result.scenarios.map((s) => s.key)).toEqual([
      "optimistic",
      "baseline",
      "pessimistic",
    ]);
  });

  it("最終資産は楽観 > 普通 > 悲観の順になる", () => {
    const [opt, base, pes] = runAllScenarios(SAFE).scenarios;
    expect(opt.finalTotal).toBeGreaterThan(base.finalTotal);
    expect(base.finalTotal).toBeGreaterThan(pes.finalTotal);
  });

  it("全シナリオで資産が残れば survivesAllScenarios は true", () => {
    const result = runAllScenarios(SAFE);
    expect(result.scenarios.every((s) => s.depletionAge === null)).toBe(true);
    expect(result.survivesAllScenarios).toBe(true);
  });

  it("全シナリオで尽きれば survivesAllScenarios は false", () => {
    const result = runAllScenarios(DOOMED);
    expect(result.scenarios.every((s) => s.depletionAge === 40)).toBe(true);
    expect(result.survivesAllScenarios).toBe(false);
  });

  it("各シナリオが同じ年数ぶんの行を持つ", () => {
    const result = runAllScenarios(SAFE);
    const lengths = result.scenarios.map((s) => s.rows.length);
    expect(new Set(lengths).size).toBe(1);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/lifeplan/scenarios.test.ts
```

期待: FAIL（`runAllScenarios` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/lifeplan/scenarios.ts`:
```ts
import { SCENARIOS } from "@/constants/lifeplan";
import { simulateCashflow } from "./cashflow";
import type { HearingSheet, LifeplanResult } from "./types";

/**
 * 楽観・普通・悲観の3シナリオを実行してまとめる（docs/requirements.md §5.2）。
 *
 * 悲観シナリオでも資産が尽きないなら、その計画は強いと判定できる。
 * これがこのツールの中心的な出力にあたる
 */
export function runAllScenarios(sheet: HearingSheet): LifeplanResult {
  const scenarios = SCENARIOS.map((assumption) => simulateCashflow(sheet, assumption));

  return {
    scenarios,
    survivesAllScenarios: scenarios.every((s) => s.depletionAge === null),
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/lifeplan/scenarios.test.ts
```

期待: 5 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/lifeplan/scenarios.ts src/lib/lifeplan/scenarios.test.ts
git commit -m "feat: 3シナリオの実行と枯渇判定を集約する"
```

---

### Task 6: 金額の表示整形

**Files:**
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `formatYen(value: number): string`, `formatCompactYen(value: number): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatCompactYen, formatYen } from "./format";

describe("formatYen", () => {
  it("3桁区切りで円を付ける", () => {
    expect(formatYen(1_234_567)).toBe("1,234,567円");
  });

  it("0を扱える", () => {
    expect(formatYen(0)).toBe("0円");
  });

  it("マイナスを扱える", () => {
    expect(formatYen(-500_000)).toBe("-500,000円");
  });
});

describe("formatCompactYen", () => {
  it("1万円未満はそのまま円で表す", () => {
    expect(formatCompactYen(5_000)).toBe("5,000円");
  });

  it("万円単位に丸める", () => {
    expect(formatCompactYen(12_340_000)).toBe("1,234万円");
  });

  it("1億円以上は億で表す", () => {
    expect(formatCompactYen(123_400_000)).toBe("1.2億円");
  });

  it("マイナスでも単位が付く", () => {
    expect(formatCompactYen(-12_340_000)).toBe("-1,234万円");
  });

  it("0は0円", () => {
    expect(formatCompactYen(0)).toBe("0円");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/format.test.ts
```

期待: FAIL

- [ ] **Step 3: 実装を書く**

`src/lib/format.ts`:
```ts
/** 3桁区切りの円表記。例: 1,234,567円 */
export function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

/**
 * グラフの軸や見出し向けの短い表記。
 * 1億円以上は「1.2億円」、1万円以上は「1,234万円」、それ未満は「5,000円」
 */
export function formatCompactYen(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 100_000_000) {
    // 小数第1位まで残す（1.2億円）
    return `${sign}${(abs / 100_000_000).toFixed(1)}億円`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 10_000).toLocaleString("ja-JP")}万円`;
  }
  return `${sign}${abs.toLocaleString("ja-JP")}円`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/format.test.ts
```

期待: 8 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: 金額の表示整形ユーティリティを追加"
```

---

### Task 7: 入力内容の永続化

**Files:**
- Create: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `HearingSheet`（Task 2）
- Produces: `saveSheet(sheet: HearingSheet): void`, `loadSheet(): HearingSheet | null`, `clearSheet(): void`, `DEFAULT_SHEET: HearingSheet`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/storage.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHEET, clearSheet, loadSheet, saveSheet } from "./storage";
import type { HearingSheet } from "./lifeplan/types";

/** localStorage の最小実装。Vitest の node 環境には存在しないため差し込む */
function installMockStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

describe("ヒアリングシートの永続化", () => {
  beforeEach(() => {
    installMockStorage();
  });

  it("保存していなければ null を返す", () => {
    expect(loadSheet()).toBeNull();
  });

  it("保存した内容をそのまま復元できる", () => {
    const sheet: HearingSheet = { ...DEFAULT_SHEET, currentAge: 45, savings: 1_000_000 };
    saveSheet(sheet);
    expect(loadSheet()).toEqual(sheet);
  });

  it("消したら null に戻る", () => {
    saveSheet(DEFAULT_SHEET);
    clearSheet();
    expect(loadSheet()).toBeNull();
  });

  it("壊れたJSONが入っていても例外を投げず null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", "{壊れている");
    expect(loadSheet()).toBeNull();
  });

  it("必須項目が欠けた古いデータは null を返す", () => {
    localStorage.setItem("lifeplan.sheet.v1", JSON.stringify({ currentAge: 40 }));
    expect(loadSheet()).toBeNull();
  });

  it("localStorage が使えない環境でも例外を投げない", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => saveSheet(DEFAULT_SHEET)).not.toThrow();
    expect(loadSheet()).toBeNull();
  });

  it("既定値は Tier 1 をすべて埋めている", () => {
    expect(DEFAULT_SHEET.currentAge).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.householdNetIncome).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.annualLivingCost).toBeGreaterThan(0);
    expect(DEFAULT_SHEET.retirementAge).toBeGreaterThan(DEFAULT_SHEET.currentAge);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/storage.test.ts
```

期待: FAIL

- [ ] **Step 3: 実装を書く**

`src/lib/storage.ts`:
```ts
import type { HearingSheet } from "./lifeplan/types";

/** 保存キー。スキーマを壊す変更をしたら v2 に上げて古いデータを無視させる */
const STORAGE_KEY = "lifeplan.sheet.v1";

/** 初回表示時の既定値。40歳・年収600万・生活費月30万の想定 */
export const DEFAULT_SHEET: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

/** Tier 1 の必須項目がすべて数値として入っているか検証する */
function isValidSheet(value: unknown): value is HearingSheet {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const requiredNumbers = [
    "currentAge",
    "householdNetIncome",
    "annualLivingCost",
    "savings",
    "investments",
    "retirementAge",
  ];
  return (
    requiredNumbers.every((k) => typeof s[k] === "number" && Number.isFinite(s[k])) &&
    typeof s.occupation === "string"
  );
}

/**
 * 入力内容をブラウザに保存する。
 * サーバーには送らない（docs/requirements.md §6）
 */
export function saveSheet(sheet: HearingSheet): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
  } catch {
    // プライベートブラウジングや容量超過で失敗しうる。保存できなくても操作は続行させる
  }
}

/**
 * 保存済みの入力内容を読み出す。
 * 未保存・破損・スキーマ不一致のいずれでも null を返し、呼び出し側は既定値にフォールバックする
 */
export function loadSheet(): HearingSheet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSheet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 保存内容を消す */
export function clearSheet(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 失敗しても致命的ではない
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/storage.test.ts
```

期待: 7 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: ヒアリングシートを localStorage に保存する

破損データやlocalStorage不可の環境でも例外を投げず既定値に戻す。"
```

---

### Task 8: ヒアリングフォーム

**Files:**
- Create: `src/components/NumberField.tsx`, `src/components/DerivedSummary.tsx`, `src/components/HearingForm.tsx`

**Interfaces:**
- Consumes: `HearingSheet`, `Child`, `LifeEvent`, `Occupation`（Task 2）、`DEFAULT_PENSION_START_AGE`（Task 2）、`formatYen`（Task 6）
- Produces:
  - `NumberField(props: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number; hint?: string })`
  - `DerivedSummary(props: { sheet: HearingSheet })`
  - `HearingForm(props: { sheet: HearingSheet; onChange: (sheet: HearingSheet) => void })`

- [ ] **Step 1: 数値入力の共通部品を作る**

`src/components/NumberField.tsx`:
```tsx
"use client";

/** ラベル付きの数値入力。空欄は0として扱い、NaN を上位に流さない */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          className="w-full rounded border border-slate-300 px-3 py-2 text-right tabular-nums focus:border-slate-500 focus:outline-none"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
        {suffix && <span className="shrink-0 text-slate-500">{suffix}</span>}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
```

- [ ] **Step 2: 導出値の表示を作る**

`src/components/DerivedSummary.tsx`:
```tsx
"use client";

import { formatYen } from "@/lib/format";
import type { HearingSheet } from "@/lib/lifeplan/types";

/**
 * 導出値を見せるパネル（docs/requirements.md §6）。
 *
 * 年間収支は入力項目ではなく「手取り年収 − 基本生活費」の計算結果。
 * ユーザーが自分の感覚と照合でき、乖離が大きければ
 * 生活費の申告が実態とずれている合図になる
 */
export function DerivedSummary({ sheet }: { sheet: HearingSheet }) {
  const annualBalance = sheet.householdNetIncome - sheet.annualLivingCost;
  const monthly = Math.round(annualBalance / 12);
  const isNegative = annualBalance < 0;

  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        isNegative ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
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
          : "これが毎年の積立額にあたります。実感と大きくずれていれば、生活費の入力を見直してください。"}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: フォーム本体を作る**

`src/components/HearingForm.tsx`:
```tsx
"use client";

import { DEFAULT_PENSION_START_AGE } from "@/constants/lifeplan";
import type { Child, HearingSheet, LifeEvent, Occupation } from "@/lib/lifeplan/types";
import { DerivedSummary } from "./DerivedSummary";
import { NumberField } from "./NumberField";

const OCCUPATION_LABELS: Record<Occupation, string> = {
  employee: "会社員",
  civil_servant: "公務員",
  self_employed: "自営業",
  other: "その他",
};

/**
 * ヒアリング項目の入力フォーム。
 * Tier 1（必須）と Tier 2（任意）を視覚的に分ける（docs/requirements.md §4）
 */
export function HearingForm({
  sheet,
  onChange,
}: {
  sheet: HearingSheet;
  onChange: (sheet: HearingSheet) => void;
}) {
  // 1項目だけ差し替えて上位に返す
  const set = <K extends keyof HearingSheet>(key: K, value: HearingSheet[K]) =>
    onChange({ ...sheet, [key]: value });

  const children = sheet.children ?? [];
  const events = sheet.customEvents ?? [];

  const setChild = (index: number, patch: Partial<Child>) => {
    const next = children.map((c, i) => (i === index ? { ...c, ...patch } : c));
    set("children", next);
  };

  const setEvent = (index: number, patch: Partial<LifeEvent>) => {
    const next = events.map((e, i) => (i === index ? { ...e, ...patch } : e));
    set("customEvents", next);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-bold text-slate-800">基本情報</h2>

        <NumberField
          label="現在の年齢"
          value={sheet.currentAge}
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

        <NumberField
          label="世帯手取り年収"
          value={sheet.householdNetIncome}
          onChange={(v) => set("householdNetIncome", v)}
          suffix="円"
          step={100_000}
          hint="配偶者がいれば合算した額"
        />

        <NumberField
          label="年間の基本生活費"
          value={sheet.annualLivingCost}
          onChange={(v) => set("annualLivingCost", v)}
          suffix="円"
          step={100_000}
          hint="月30万円なら 3,600,000"
        />

        <NumberField
          label="現在の貯金"
          value={sheet.savings}
          onChange={(v) => set("savings", v)}
          suffix="円"
          step={100_000}
          hint="利回りがつかない現金"
        />

        <NumberField
          label="現在の投資額"
          value={sheet.investments}
          onChange={(v) => set("investments", v)}
          suffix="円"
          step={100_000}
          hint="利回りが適用される資産"
        />

        <NumberField
          label="リタイア予定年齢"
          value={sheet.retirementAge}
          onChange={(v) => set("retirementAge", v)}
          suffix="歳"
        />

        <DerivedSummary sheet={sheet} />
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div>
          <h2 className="text-base font-bold text-slate-800">より詳しく（任意）</h2>
          <p className="mt-1 text-xs text-slate-500">
            入力すると精度が上がります。空欄のままでも試算できます。
          </p>
        </div>

        <NumberField
          label="退職金"
          value={sheet.retirementLumpSum ?? 0}
          onChange={(v) => set("retirementLumpSum", v)}
          suffix="円"
          step={1_000_000}
          hint="リタイアした年に一度だけ加算されます"
        />

        <NumberField
          label="年金の年額"
          value={sheet.pensionAnnual ?? 0}
          onChange={(v) => set("pensionAnnual", v)}
          suffix="円"
          step={100_000}
          hint="ねんきんネットの見込額を入れてください"
        />

        <NumberField
          label="年金の受給開始年齢"
          value={sheet.pensionStartAge ?? DEFAULT_PENSION_START_AGE}
          onChange={(v) => set("pensionStartAge", v)}
          suffix="歳"
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">子供</span>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              onClick={() => set("children", [...children, { age: 0, path: "public" }])}
            >
              追加
            </button>
          </div>

          {children.length === 0 && (
            <p className="text-xs text-slate-500">
              追加すると、進学時期に合わせた教育費が自動で支出に計上されます。
            </p>
          )}

          {children.map((child, i) => (
            <div
              key={i}
              className="flex items-end gap-2 rounded border border-slate-200 bg-white p-3"
            >
              <div className="flex-1">
                <NumberField
                  label={`第${i + 1}子の年齢`}
                  value={child.age}
                  onChange={(v) => setChild(i, { age: v })}
                  suffix="歳"
                />
              </div>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">進路</span>
                <select
                  className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                  value={child.path}
                  onChange={(e) =>
                    setChild(i, { path: e.target.value as Child["path"] })
                  }
                >
                  <option value="public">公立</option>
                  <option value="private">私立</option>
                </select>
              </label>
              <button
                type="button"
                className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                onClick={() => set("children", children.filter((_, j) => j !== i))}
              >
                削除
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              大きな支出の予定
            </span>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100"
              onClick={() =>
                set("customEvents", [
                  ...events,
                  { age: sheet.currentAge + 5, amount: 30_000_000, label: "住宅購入" },
                ])
              }
            >
              追加
            </button>
          </div>

          {events.length === 0 && (
            <p className="text-xs text-slate-500">
              住宅購入・車の買い替え・リフォームなど、特定の年にまとまって出ていくお金を登録できます。
            </p>
          )}

          {events.map((event, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">内容</span>
                <input
                  type="text"
                  className="rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                  value={event.label}
                  onChange={(e) => setEvent(i, { label: e.target.value })}
                />
              </label>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <NumberField
                    label="発生する年齢"
                    value={event.age}
                    onChange={(v) => setEvent(i, { age: v })}
                    suffix="歳"
                  />
                </div>
                <div className="flex-[2]">
                  <NumberField
                    label="金額"
                    value={event.amount}
                    onChange={(v) => setEvent(i, { amount: v })}
                    suffix="円"
                    step={1_000_000}
                  />
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100"
                  onClick={() =>
                    set("customEvents", events.filter((_, j) => j !== i))
                  }
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: 型チェックとビルドを通す**

```bash
npm run typecheck
npm run lint
```

期待: どちらもエラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/NumberField.tsx src/components/DerivedSummary.tsx src/components/HearingForm.tsx
git commit -m "feat: ヒアリングフォームと導出値パネルを追加

年間収支は入力させず導出値として表示し、生活費の申告ずれに気付けるようにする。
子供と大きな支出の予定（住宅購入など）は行の追加・削除ができる。"
```

---

### Task 9: グラフと枯渇判定の表示

**Files:**
- Create: `src/components/CashflowChart.tsx`, `src/components/DepletionVerdict.tsx`

**Interfaces:**
- Consumes: `LifeplanResult`, `ScenarioKey`（Task 2）、`formatCompactYen`（Task 6）
- Produces:
  - `CashflowChart(props: { result: LifeplanResult })`
  - `DepletionVerdict(props: { result: LifeplanResult })`

- [ ] **Step 1: 判定表示を作る**

`src/components/DepletionVerdict.tsx`:
```tsx
"use client";

import { formatCompactYen } from "@/lib/format";
import type { LifeplanResult } from "@/lib/lifeplan/types";

/**
 * 「資産が尽きる年」の判定（docs/requirements.md §5.3）。
 *
 * これはグラフの付属情報ではなく、このツールの主役として扱う。
 * 悲観シナリオでも尽きなければ、その計画は強い
 */
export function DepletionVerdict({ result }: { result: LifeplanResult }) {
  const { scenarios, survivesAllScenarios } = result;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-lg border p-4 ${
          survivesAllScenarios
            ? "border-emerald-300 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
        }`}
      >
        <div className="text-lg font-bold text-slate-900">
          {survivesAllScenarios
            ? "悲観シナリオでも資産は尽きません"
            : "資産が尽きるシナリオがあります"}
        </div>
        <p className="mt-1 text-sm text-slate-700">
          {survivesAllScenarios
            ? "この計画は強いと言えます。使う側に回す余地がないか、一度考えてみてください。"
            : "打ち手は5つです。生活費を下げる / 収入を増やす / 利回り・期間を見直す / 想定外の支出を防ぐ / 支出の優先順位を見直す。左のフォームを変えてその場で試せます。"}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.key} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className="mt-1 text-sm font-bold text-slate-900">
              {s.depletionAge === null ? (
                <span className="text-emerald-700">尽きない</span>
              ) : (
                <span className="text-red-700">{s.depletionAge}歳で尽きる</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              95歳時点 {formatCompactYen(s.finalTotal)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: グラフを作る**

`src/components/CashflowChart.tsx`:
```tsx
"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactYen } from "@/lib/format";
import type { LifeplanResult, ScenarioKey } from "@/lib/lifeplan/types";

/** シナリオごとの線の色 */
const COLORS: Record<ScenarioKey, string> = {
  optimistic: "#0ea5e9",
  baseline: "#334155",
  pessimistic: "#dc2626",
};

/**
 * 3シナリオの総資産推移を重ねて描く（docs/requirements.md §5.3）。
 *
 * 0円の水平線を引くことで「どこで水面下に入るか」が一目で分かるようにする
 */
export function CashflowChart({ result }: { result: LifeplanResult }) {
  const [first] = result.scenarios;
  if (!first) return null;

  // recharts は「1行 = 1つのX座標」の形を求めるので、年齢をキーに横に並べ直す
  const data = first.rows.map((row, i) => {
    const point: Record<string, number> = { age: row.age };
    for (const s of result.scenarios) {
      point[s.key] = s.rows[i].total;
    }
    return point;
  });

  return (
    <div className="h-[360px] w-full rounded-lg border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => `${v}歳`}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            width={70}
            tickFormatter={(v: number) => formatCompactYen(v)}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatCompactYen(value), name]}
            labelFormatter={(label: number) => `${label}歳`}
          />
          <Legend />
          {/* 資産ゼロの線。ここを下回った時点で計画は破綻している */}
          <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.5} />
          {result.scenarios.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={COLORS[s.key]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: 型チェックを通す**

```bash
npm run typecheck
npm run lint
```

期待: どちらもエラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/CashflowChart.tsx src/components/DepletionVerdict.tsx
git commit -m "feat: 3シナリオの資産推移グラフと枯渇判定表示を追加"
```

---

### Task 10: ページ統合

**Files:**
- Create: `src/components/Simulator.tsx`, `src/app/privacy/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `HearingForm`（Task 8）、`CashflowChart`, `DepletionVerdict`（Task 9）、`runAllScenarios`（Task 5）、`DEFAULT_SHEET`, `loadSheet`, `saveSheet`, `clearSheet`（Task 7）
- Produces: 動作する1画面のアプリ

- [ ] **Step 1: 状態管理コンポーネントを作る**

`src/components/Simulator.tsx`:
```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { runAllScenarios } from "@/lib/lifeplan/scenarios";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { DEFAULT_SHEET, clearSheet, loadSheet, saveSheet } from "@/lib/storage";
import { CashflowChart } from "./CashflowChart";
import { DepletionVerdict } from "./DepletionVerdict";
import { HearingForm } from "./HearingForm";

/**
 * 全体の組み立て。
 *
 * 入力を変えるたびに即座に再計算してグラフを更新する。
 * 「どの項目をいじると資産が尽きる年がどう動くか」をその場で試せることが
 * このツールの本命の体験（docs/requirements.md §6）
 */
export function Simulator() {
  const [sheet, setSheet] = useState<HearingSheet>(DEFAULT_SHEET);

  // localStorage は静的エクスポート時のプリレンダリングでは触れないので、
  // マウント後に読み込んで差し替える
  useEffect(() => {
    const saved = loadSheet();
    if (saved) setSheet(saved);
  }, []);

  useEffect(() => {
    saveSheet(sheet);
  }, [sheet]);

  // 入力が変わったときだけ再計算する
  const result = useMemo(() => runAllScenarios(sheet), [sheet]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <HearingForm sheet={sheet} onChange={setSheet} />
        <button
          type="button"
          className="self-start text-xs text-slate-500 underline hover:text-slate-800"
          onClick={() => {
            clearSheet();
            setSheet(DEFAULT_SHEET);
          }}
        >
          入力内容を消して初期値に戻す
        </button>
      </div>
      <div className="flex flex-col gap-6">
        <DepletionVerdict result={result} />
        <CashflowChart result={result} />
        <p className="text-xs text-slate-500">
          楽観＝利回り5%・昇給2%・インフレ1% ／ 普通＝3.5%・1%・2% ／
          悲観＝2%・0%・3%。95歳までを試算しています。
          この結果は特定の金融商品を推奨するものではありません。
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: トップページを差し替える**

`src/app/page.tsx`:
```tsx
import Link from "next/link";
import { Simulator } from "@/components/Simulator";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">ライフプランシミュレーター</h1>
        <p className="mt-2 text-sm text-slate-600">
          年齢・収支・家族構成から将来の資産推移を試算し、
          <strong>資産が何歳で尽きるか</strong>を楽観・普通・悲観の3シナリオで確かめます。
        </p>
        <p className="mt-2 text-xs text-slate-500">
          入力内容はお使いのブラウザにのみ保存され、サーバーには送信されません。
          <Link href="/privacy" className="ml-1 underline">
            プライバシーについて
          </Link>
        </p>
      </header>
      <Simulator />
    </main>
  );
}
```

- [ ] **Step 3: プライバシーページを作る**

`src/app/privacy/page.tsx`:
```tsx
import Link from "next/link";

export const metadata = {
  title: "プライバシーについて | ライフプランシミュレーター",
};

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">プライバシーについて</h1>

      <section className="mt-6 flex flex-col gap-3 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-bold text-slate-900">入力内容の扱い</h2>
        <p>
          年齢・年収・資産額・家族構成などの入力内容は、
          <strong>お使いのブラウザ（localStorage）にのみ保存されます。</strong>
          当サイトのサーバーに送信・保存されることはありません。
        </p>
        <p>
          ブラウザのデータを消去すると入力内容も消えます。
          共用の端末でお使いの場合はご注意ください。
        </p>

        <h2 className="mt-4 text-base font-bold text-slate-900">試算結果について</h2>
        <p>
          本サイトの試算は一定の前提を置いた概算であり、将来を保証するものではありません。
          特定の金融商品を推奨するものでもありません。
          実際の意思決定にあたっては、ご自身で最新の情報をご確認ください。
        </p>
      </section>

      <Link href="/" className="mt-8 inline-block text-sm underline">
        トップに戻る
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: 全テストとビルドを通す**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

期待: テスト全件 pass、型・lint エラーなし、`out/` が生成される

- [ ] **Step 5: 開発サーバーで実機確認**

```bash
npm run dev
```

ブラウザで <http://localhost:3000> を開き、以下を目視確認する:
- フォームの値を変えるとグラフが即座に更新される
- 生活費を年収より大きくすると年間収支が赤字表示になる
- 生活費を大きくしていくと「◯歳で尽きる」に切り替わる
- 子供を追加すると進学時期にグラフが下向きに折れる
- 「大きな支出の予定」を追加するとその年齢でグラフが落ち込む
- ページを再読み込みしても入力内容が残っている
- 「入力内容を消して初期値に戻す」を押すと初期値に戻り、再読み込みしても戻ったままになる

- [ ] **Step 6: コミット**

```bash
git add src/components/Simulator.tsx src/app/page.tsx src/app/privacy/page.tsx
git commit -m "feat: フォーム・グラフ・判定を1画面に統合

入力変更のたびに即再計算し、打ち手をその場で試せるようにする。"
```

---

### Task 11: デプロイ設定と README

**Files:**
- Create: `README.md`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: Task 1〜10 のすべて
- Produces: `npm run deploy` でデプロイできる状態

- [ ] **Step 1: カスタムドメインを wrangler.jsonc に追加**

`wrangler.jsonc` の末尾に `routes` を追加する:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "lifeplan-simulator",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./out",
    "not_found_handling": "404-page"
  },
  "routes": [
    {
      "pattern": "lifeplan.nexeed-lab.com",
      "custom_domain": true
    }
  ]
}
```

- [ ] **Step 2: README を書く**

`README.md`:
```markdown
# ライフプランシミュレーター

年齢・収支・家族構成から将来の資産推移を試算し、**資産が何歳で尽きるか**を
楽観・普通・悲観の3シナリオで可視化するWebサイト。

- 要件定義: [docs/requirements.md](docs/requirements.md)
- 実装計画: [docs/plans/](docs/plans/)

## 開発

```bash
npm install
npm run dev        # 開発サーバー (http://localhost:3000)
npm test           # 計算エンジンのユニットテスト (Vitest)
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run build      # 本番ビルド（静的エクスポート → out/）
```

## デプロイ（Cloudflare Workers）

静的エクスポートした `out/` を Cloudflare Workers（Static Assets）で配信する。
設定は [wrangler.jsonc](wrangler.jsonc)。

```bash
npx wrangler login   # 初回のみ（または CLOUDFLARE_API_TOKEN を設定）
npm run deploy       # next build && wrangler deploy
npm run preview      # ローカルでCloudflare配信を再現（wrangler dev）
```

## 構成

| ディレクトリ | 内容 |
|---|---|
| `src/lib/lifeplan/` | 計算エンジン（UI非依存の純粋関数・テスト必須） |
| `src/constants/` | 寿命・3シナリオの前提値・教育費テーブル。**統計や制度が変わったらここだけ直す** |
| `src/lib/storage.ts` | 入力内容の localStorage 保存 |
| `src/components/` | UIコンポーネント |
| `src/app/` | ページ |

## 計算仕様

詳細は [docs/requirements.md §5](docs/requirements.md)。要点:

- 現在年齢から**95歳**までを1年刻みで試算する
- **貯金には利回りを適用せず、投資にのみ適用する。** 1本にまとめると資産推移を過大評価する
- 赤字はまず貯金から取り崩し、貯金が尽きてから投資に手を付ける
- インフレ率は支出に、昇給率は給与に、利回りは投資に適用する（名目）
- 教育費は文部科学省「令和5年度 子供の学習費調査」の**2026年1月16日訂正版**を使用。
  初回公表値がネット上に多く残っているが誤りなので注意

## 現状

Phase 1（フォーム入力）まで実装済み。
Phase 2 でAIヒアリング層を載せる予定（[docs/requirements.md §3](docs/requirements.md)）。
```

- [ ] **Step 3: 最終確認**

```bash
npm test
npm run build
```

期待: 全テスト pass、`out/index.html` と `out/privacy/index.html` が生成される

- [ ] **Step 4: コミット**

```bash
git add README.md wrangler.jsonc
git commit -m "docs: README とデプロイ設定を追加"
```

- [ ] **Step 5: プッシュ**

```bash
git push
```

---

## Phase 1 完了条件

- [ ] `npm test` が全件 pass する
- [ ] `npm run typecheck` と `npm run lint` がエラーなし
- [ ] `npm run build` が `out/` を生成する
- [ ] フォームの値を変えるとグラフが即座に更新される
- [ ] 「資産が尽きる年」の判定が3シナリオぶん表示される
- [ ] 再読み込みしても入力内容が残る
- [ ] プライバシーページが存在し、トップからリンクされている

## Phase 2 への引き継ぎ

Phase 2（AIヒアリング層）で追加するもの。Phase 1 では**作らない**。

| 追加物 | 備考 |
|---|---|
| `src/app/api/chat/` 相当の Worker | 静的エクスポートとは別に Worker スクリプトを持つ構成に変更が要る |
| サーバー側ステートマシン | Tier 1/2 の未入力判定ロジックは `HearingSheet` の型をそのまま使える |
| チャットUI | `HearingForm` は残し、併置する |
| Turnstile / Durable Object / AI Gateway | `docs/requirements.md` §7 |

**Phase 2 に着手する前に、AI Gateway の Budget Limit の月額上限値を決めること。**
