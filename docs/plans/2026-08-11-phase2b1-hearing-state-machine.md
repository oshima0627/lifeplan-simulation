# Phase 2b-1: ヒアリングのステートマシン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「何が未入力か」「次に何を聞くか」「抽出結果を受け入れてよいか」を判定する純粋関数群を作る。LLMにこの判断を一切させないための土台。

**Architecture:** `src/lib/hearing/` に UI非依存・React非依存の純粋関数として置く。Worker からもブラウザからも同じコードを呼べる。この Phase では **LLMもWorkerも書かない**。

**Tech Stack:** TypeScript / Vitest（既存構成のまま。新規依存なし）

**なぜLLMに持たせないか（`docs/requirements.md` §3.1）:** 多ターン会話ではLLMは序盤の前提に固執し、道を誤ると回復しない（*LLMs Get Lost In Multi-Turn Conversation*, ICLR 2026 Outstanding Paper — 情報を1ターンずつ小出しにする設定で全モデルが平均39%性能低下、内訳は能力低下ではなく**信頼性の低下**）。LLMに毎ターン「今回のターンの内容だけ」を担当させれば、20ターン先で文脈を見失っても影響しない。**その「毎ターンの担当範囲」を決めるのがこのステートマシン。**

**コスト露出ゼロ。** APIキーもデプロイも不要で、単体で完結して検証できる。

## Global Constraints

- 仕様は `docs/requirements.md` が唯一の情報源。特に **§3.1（役割分担）・§3.2（API呼び出しの形）・§4（ヒアリングシート）**
- 金額はすべて円（number）、率はすべてパーセント（number）
- **`src/lib/hearing/` は React にも Worker ランタイムにも依存させない。** ブラウザとWorkerの両方から呼ぶ
- テストは実装ファイルと同じディレクトリに `*.test.ts` として置く
- ドキュメントコメントとテストの説明文は**日本語**で書く
- 数値リテラルは桁区切りを使う
- パスエイリアス `@/` は `src/` を指す
- **この Phase では Worker も LLM 呼び出しも書かない。** `src/app/api/` を作らない、`wrangler.jsonc` を変えない、Anthropic SDK を入れない
- **計算エンジン（`src/lib/lifeplan/`）と保存（`src/lib/storage.ts`）を変更しない**

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/lib/hearing/fields.ts` | 項目の定義（Tier・表示名・検証範囲）。**項目を増やすときはここだけ直す** |
| `src/lib/hearing/validate.ts` | 1項目ぶんの値の検証。JSON Schema で表現できない範囲チェックを担う |
| `src/lib/hearing/state.ts` | 未入力判定・次に聞く項目・進捗・フェーズ |
| `src/lib/hearing/apply.ts` | LLMの抽出結果をシートにマージする。不正な値は捨てて理由を返す |

---

### Task 1: 項目定義

**Files:**
- Create: `src/lib/hearing/fields.ts`
- Test: `src/lib/hearing/fields.test.ts`

**Interfaces:**
- Consumes: `HearingSheet`, `Occupation`（`@/lib/lifeplan/types`）
- Produces:
  - 型 `FieldKey`, `FieldSpec`
  - 定数 `HEARING_FIELDS: readonly FieldSpec[]`
  - 関数 `fieldSpec(key: FieldKey): FieldSpec`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/hearing/fields.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HEARING_FIELDS, fieldSpec } from "./fields";

describe("HEARING_FIELDS", () => {
  it("Tier 1 は仕様の7項目を過不足なく持つ", () => {
    const tier1 = HEARING_FIELDS.filter((f) => f.tier === 1).map((f) => f.key);
    expect(new Set(tier1)).toEqual(
      new Set([
        "currentAge",
        "occupation",
        "householdNetIncome",
        "annualLivingCost",
        "savings",
        "investments",
        "retirementAge",
      ]),
    );
  });

  it("Tier 2 は仕様の5項目を持つ", () => {
    const tier2 = HEARING_FIELDS.filter((f) => f.tier === 2).map((f) => f.key);
    expect(new Set(tier2)).toEqual(
      new Set([
        "children",
        "retirementLumpSum",
        "pensionAnnual",
        "pensionStartAge",
        "customEvents",
      ]),
    );
  });

  it("キーが重複していない", () => {
    const keys = HEARING_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("すべての項目が日本語の表示名を持つ", () => {
    for (const f of HEARING_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("数値項目は検証範囲を持つ", () => {
    for (const f of HEARING_FIELDS) {
      if (f.kind === "number") {
        expect(f.min).toBeTypeOf("number");
        expect(f.max).toBeTypeOf("number");
        expect(f.max).toBeGreaterThan(f.min);
      }
    }
  });

  it("fieldSpec はキーから定義を引ける", () => {
    expect(fieldSpec("currentAge").tier).toBe(1);
    expect(fieldSpec("pensionAnnual").tier).toBe(2);
  });

  it("Tier 1 の項目は聞く順序が定義の順に並んでいる", () => {
    // 年齢 → 職業 → 収入 → 支出 → 資産 → リタイア年齢 の順で聞く。
    // いきなり資産額から聞かれると答えにくいため
    const tier1 = HEARING_FIELDS.filter((f) => f.tier === 1).map((f) => f.key);
    expect(tier1[0]).toBe("currentAge");
    expect(tier1.at(-1)).toBe("retirementAge");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/hearing/fields.test.ts
```

期待: FAIL（`./fields` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/hearing/fields.ts`:
```ts
import type { HearingSheet } from "@/lib/lifeplan/types";

/** ヒアリングで埋める項目のキー。`HearingSheet` のキーと1対1に対応する */
export type FieldKey = keyof HearingSheet;

/**
 * 1項目ぶんの定義。
 *
 * **項目を増やすときはこの配列だけ直す。** 未入力判定も進捗も
 * ここから導出されるので、他の場所に項目名を書かない
 */
export type FieldSpec =
  | {
      key: FieldKey;
      /** 1 = 必須、2 = 任意（docs/requirements.md §4） */
      tier: 1 | 2;
      kind: "number";
      /** 画面と会話で使う日本語の表示名 */
      label: string;
      /** 受け入れる最小値（この値を含む） */
      min: number;
      /** 受け入れる最大値（この値を含む） */
      max: number;
      /** 整数のみ受け付けるか */
      integer: boolean;
    }
  | {
      key: FieldKey;
      tier: 1 | 2;
      kind: "enum";
      label: string;
      /** 受け入れる値の一覧 */
      values: readonly string[];
    }
  | {
      key: FieldKey;
      tier: 1 | 2;
      kind: "list";
      label: string;
    };

/**
 * ヒアリング項目の定義（docs/requirements.md §4）。
 *
 * **配列の順序が、そのまま質問の順序になる。**
 * 年齢・職業のような答えやすい項目を先に置き、資産額を後ろに回している。
 * いきなり貯金額から聞かれると身構えられて離脱するため
 */
export const HEARING_FIELDS: readonly FieldSpec[] = [
  // --- Tier 1（必須） ---
  { key: "currentAge", tier: 1, kind: "number", label: "現在の年齢", min: 18, max: 94, integer: true },
  {
    key: "occupation",
    tier: 1,
    kind: "enum",
    label: "職業",
    values: ["employee", "civil_servant", "self_employed", "other"],
  },
  { key: "householdNetIncome", tier: 1, kind: "number", label: "世帯手取り年収", min: 0, max: 1_000_000_000, integer: true },
  { key: "annualLivingCost", tier: 1, kind: "number", label: "年間の基本生活費", min: 0, max: 1_000_000_000, integer: true },
  { key: "savings", tier: 1, kind: "number", label: "現在の貯金", min: 0, max: 100_000_000_000, integer: true },
  { key: "investments", tier: 1, kind: "number", label: "現在の投資額", min: 0, max: 100_000_000_000, integer: true },
  { key: "retirementAge", tier: 1, kind: "number", label: "リタイア予定年齢", min: 18, max: 95, integer: true },

  // --- Tier 2（任意） ---
  { key: "children", tier: 2, kind: "list", label: "子供" },
  { key: "retirementLumpSum", tier: 2, kind: "number", label: "退職金", min: 0, max: 1_000_000_000, integer: true },
  { key: "pensionAnnual", tier: 2, kind: "number", label: "年金の年額", min: 0, max: 100_000_000, integer: true },
  { key: "pensionStartAge", tier: 2, kind: "number", label: "年金の受給開始年齢", min: 60, max: 95, integer: true },
  { key: "customEvents", tier: 2, kind: "list", label: "大きな支出の予定" },
];

/** キーから定義を引く。未知のキーは呼び出し側のバグなので例外にする */
export function fieldSpec(key: FieldKey): FieldSpec {
  const spec = HEARING_FIELDS.find((f) => f.key === key);
  if (!spec) throw new Error(`未定義のヒアリング項目です: ${String(key)}`);
  return spec;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/hearing/fields.test.ts
```

期待: 7 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/hearing/fields.ts src/lib/hearing/fields.test.ts
git commit -m "feat: ヒアリング項目の定義を追加

項目を増やすときはこの配列だけ直せばよいように、Tier・表示名・
検証範囲を1箇所に集約した。配列の順序がそのまま質問の順序になる。"
```

---

### Task 2: 値の検証

**Files:**
- Create: `src/lib/hearing/validate.ts`
- Test: `src/lib/hearing/validate.test.ts`

**Interfaces:**
- Consumes: `FieldKey`, `FieldSpec`, `fieldSpec`（Task 1）
- Produces: `validateField(key: FieldKey, value: unknown): ValidationResult`
  - `type ValidationResult = { ok: true; value: unknown } | { ok: false; reason: string }`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/hearing/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateField } from "./validate";

describe("validateField — 数値項目", () => {
  it("範囲内の整数を受け入れる", () => {
    expect(validateField("currentAge", 40)).toEqual({ ok: true, value: 40 });
  });

  it("下限・上限ちょうどを受け入れる", () => {
    expect(validateField("currentAge", 18).ok).toBe(true);
    expect(validateField("currentAge", 94).ok).toBe(true);
  });

  it("範囲外を拒否する", () => {
    expect(validateField("currentAge", 17).ok).toBe(false);
    expect(validateField("currentAge", 95).ok).toBe(false);
  });

  it("小数を整数に丸めてから範囲を見る", () => {
    // LLMが「6歳半」を 6.5 として返しうる。丸めずに通すと
    // 教育費の年次ループと噛み合わず、費用が丸ごと消える
    expect(validateField("currentAge", 40.4)).toEqual({ ok: true, value: 40 });
    expect(validateField("currentAge", 40.6)).toEqual({ ok: true, value: 41 });
  });

  it("NaN と Infinity を拒否する", () => {
    expect(validateField("currentAge", NaN).ok).toBe(false);
    expect(validateField("currentAge", Infinity).ok).toBe(false);
    expect(validateField("currentAge", -Infinity).ok).toBe(false);
  });

  it("数値でない値を拒否する", () => {
    expect(validateField("currentAge", "40").ok).toBe(false);
    expect(validateField("currentAge", null).ok).toBe(false);
    expect(validateField("currentAge", undefined).ok).toBe(false);
    expect(validateField("currentAge", {}).ok).toBe(false);
  });

  it("拒否したときは日本語の理由を返す", () => {
    const r = validateField("currentAge", 200);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("現在の年齢");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("validateField — enum項目", () => {
  it("定義済みの値を受け入れる", () => {
    expect(validateField("occupation", "employee")).toEqual({
      ok: true,
      value: "employee",
    });
  });

  it("定義外の値を拒否する", () => {
    // Sonnet は不足パラメータを推測で埋めることがある（§3.3）。
    // enum で縛っていても、抽出結果の検証で最終的に弾く
    expect(validateField("occupation", "会社役員").ok).toBe(false);
    expect(validateField("occupation", "").ok).toBe(false);
    expect(validateField("occupation", 1).ok).toBe(false);
  });
});

describe("validateField — リスト項目", () => {
  it("配列を受け入れる", () => {
    expect(validateField("children", []).ok).toBe(true);
  });

  it("配列でない値を拒否する", () => {
    expect(validateField("children", "2人").ok).toBe(false);
    expect(validateField("children", 2).ok).toBe(false);
    expect(validateField("children", null).ok).toBe(false);
  });
});

describe("validateField — 未知のキー", () => {
  it("未知のキーは拒否する（例外にしない）", () => {
    // LLM がスキーマに無いキーを返しうる。呼び出し側を落とさず、
    // 拒否として扱って捨てる
    // @ts-expect-error 意図的に未定義のキーを渡す
    expect(validateField("nonexistentField", 1).ok).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/hearing/validate.test.ts
```

期待: FAIL

- [ ] **Step 3: 実装を書く**

`src/lib/hearing/validate.ts`:
```ts
import { HEARING_FIELDS, type FieldKey } from "./fields";

/** 検証の結果。受け入れる場合は正規化後の値を返す */
export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/**
 * 1項目ぶんの値を検証する。
 *
 * **なぜコード側で検証するのか（docs/requirements.md §3.2）:**
 * `output_config.format` の JSON Schema は `minimum` / `maximum` を
 * サポートしないため、範囲はスキーマで縛れない。
 * また §3.3 の通り Sonnet は不足パラメータを推測で埋めることがあり、
 * その値は「エラー」ではなく「もっともらしい嘘」として届く。
 * ここが最後の関門になる。
 *
 * 未知のキーは**例外にせず拒否として返す。** LLMがスキーマに無いキーを
 * 返してきたときに、呼び出し側を落とさないため
 */
export function validateField(key: FieldKey, value: unknown): ValidationResult {
  const spec = HEARING_FIELDS.find((f) => f.key === key);
  if (!spec) {
    return { ok: false, reason: `未知の項目です: ${String(key)}` };
  }

  if (spec.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, reason: `${spec.label}は数値で入力してください` };
    }
    // 丸めてから範囲を見る。丸めた結果が範囲外になる場合も拒否する
    const normalized = spec.integer ? Math.round(value) : value;
    if (normalized < spec.min || normalized > spec.max) {
      return {
        ok: false,
        reason: `${spec.label}は${spec.min}〜${spec.max}の範囲で入力してください`,
      };
    }
    return { ok: true, value: normalized };
  }

  if (spec.kind === "enum") {
    if (typeof value !== "string" || !spec.values.includes(value)) {
      return {
        ok: false,
        reason: `${spec.label}は${spec.values.join(" / ")}のいずれかを指定してください`,
      };
    }
    return { ok: true, value };
  }

  // kind === "list"
  if (!Array.isArray(value)) {
    return { ok: false, reason: `${spec.label}は一覧で指定してください` };
  }
  return { ok: true, value };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/hearing/validate.test.ts
```

期待: 12 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/hearing/validate.ts src/lib/hearing/validate.test.ts
git commit -m "feat: ヒアリング項目の値検証を追加

output_config.format の JSON Schema は minimum/maximum を扱えず、
Sonnet は不足パラメータを推測で埋めることがある。範囲検証は
コード側が最後の関門になる。未知のキーは例外にせず拒否として返す。"
```

---

### Task 3: 未入力判定と進行

**Files:**
- Create: `src/lib/hearing/state.ts`
- Test: `src/lib/hearing/state.test.ts`

**Interfaces:**
- Consumes: `HEARING_FIELDS`, `FieldKey`（Task 1）、`HearingSheet`
- Produces:
  - `type HearingPhase = "tier1" | "tier2" | "complete"`
  - `missingFields(sheet: Partial<HearingSheet>, tier: 1 | 2): FieldKey[]`
  - `currentPhase(sheet: Partial<HearingSheet>): HearingPhase`
  - `nextField(sheet: Partial<HearingSheet>): FieldKey | null`
  - `progress(sheet: Partial<HearingSheet>): { filled: number; total: number }`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/hearing/state.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { currentPhase, missingFields, nextField, progress } from "./state";

/** Tier 1 がすべて埋まったシート */
const TIER1_DONE: Partial<HearingSheet> = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("missingFields", () => {
  it("空のシートでは Tier 1 が7項目すべて未入力", () => {
    expect(missingFields({}, 1)).toHaveLength(7);
  });

  it("埋まった項目は未入力に含まれない", () => {
    const missing = missingFields({ currentAge: 40 }, 1);
    expect(missing).not.toContain("currentAge");
    expect(missing).toHaveLength(6);
  });

  it("Tier 1 が揃えば未入力は空になる", () => {
    expect(missingFields(TIER1_DONE, 1)).toEqual([]);
  });

  it("0 は「入力済み」として扱う", () => {
    // 貯金0円・年金0円は正当な入力。未入力と混同すると永久に聞き続ける
    const missing = missingFields({ ...TIER1_DONE, savings: 0 }, 1);
    expect(missing).not.toContain("savings");
  });

  it("undefined は未入力として扱う", () => {
    const missing = missingFields({ ...TIER1_DONE, savings: undefined }, 1);
    expect(missing).toContain("savings");
  });

  it("Tier 2 の未入力も数えられる", () => {
    expect(missingFields({}, 2)).toHaveLength(5);
    expect(missingFields({ pensionAnnual: 1_800_000 }, 2)).toHaveLength(4);
  });

  it("空配列は「入力済み」として扱う", () => {
    // 「子供はいません」と答えた結果の空配列は、聞き終わった状態
    expect(missingFields({ children: [] }, 2)).not.toContain("children");
  });
});

describe("currentPhase", () => {
  it("Tier 1 に未入力があれば tier1", () => {
    expect(currentPhase({})).toBe("tier1");
    expect(currentPhase({ currentAge: 40 })).toBe("tier1");
  });

  it("Tier 1 が揃い Tier 2 が残っていれば tier2", () => {
    expect(currentPhase(TIER1_DONE)).toBe("tier2");
  });

  it("すべて揃えば complete", () => {
    const all: Partial<HearingSheet> = {
      ...TIER1_DONE,
      children: [],
      retirementLumpSum: 0,
      pensionAnnual: 1_800_000,
      pensionStartAge: 65,
      customEvents: [],
    };
    expect(currentPhase(all)).toBe("complete");
  });
});

describe("nextField", () => {
  it("空のシートでは定義順の先頭を返す", () => {
    expect(nextField({})).toBe("currentAge");
  });

  it("埋まった項目は飛ばす", () => {
    expect(nextField({ currentAge: 40 })).toBe("occupation");
  });

  it("Tier 1 を終えたら Tier 2 の先頭に進む", () => {
    expect(nextField(TIER1_DONE)).toBe("children");
  });

  it("すべて揃えば null を返す", () => {
    const all: Partial<HearingSheet> = {
      ...TIER1_DONE,
      children: [],
      retirementLumpSum: 0,
      pensionAnnual: 1_800_000,
      pensionStartAge: 65,
      customEvents: [],
    };
    expect(nextField(all)).toBeNull();
  });

  it("Tier 1 が残っていれば Tier 2 が埋まっていても Tier 1 を優先する", () => {
    // 計算できない状態のまま任意項目を聞き続けるのを防ぐ
    expect(nextField({ pensionAnnual: 1_800_000 })).toBe("currentAge");
  });
});

describe("progress", () => {
  it("空のシートは 0 / 12", () => {
    expect(progress({})).toEqual({ filled: 0, total: 12 });
  });

  it("Tier 1 が揃えば 7 / 12", () => {
    expect(progress(TIER1_DONE)).toEqual({ filled: 7, total: 12 });
  });

  it("進捗は LLM ではなくこの関数が算出する", () => {
    // §3.1: 進捗の表示も含め、状態の管理はすべてコード側の責務
    const p = progress({ currentAge: 40, occupation: "employee" });
    expect(p.filled).toBe(2);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/hearing/state.test.ts
```

期待: FAIL

- [ ] **Step 3: 実装を書く**

`src/lib/hearing/state.ts`:
```ts
import type { HearingSheet } from "@/lib/lifeplan/types";
import { HEARING_FIELDS, type FieldKey } from "./fields";

/** ヒアリングの進行段階 */
export type HearingPhase = "tier1" | "tier2" | "complete";

/**
 * その項目が入力済みかどうか。
 *
 * **`0` と空配列は「入力済み」。** 貯金0円・年金0円・子供なしは
 * どれも正当な回答であり、未入力と混同すると永久に聞き続けることになる。
 * 未入力は `undefined`（および `null`）だけ
 */
function isFilled(sheet: Partial<HearingSheet>, key: FieldKey): boolean {
  const v = sheet[key];
  return v !== undefined && v !== null;
}

/** 指定した Tier の未入力項目を、定義順で返す */
export function missingFields(
  sheet: Partial<HearingSheet>,
  tier: 1 | 2,
): FieldKey[] {
  return HEARING_FIELDS.filter((f) => f.tier === tier && !isFilled(sheet, f.key)).map(
    (f) => f.key,
  );
}

/**
 * いまどの段階にいるか（docs/requirements.md §4）。
 *
 * Tier 1 が埋まるまでは会話を終わらせない。埋まったら
 * 「一度計算できます。もう少し精度を上げますか？」と提案する段階に進む
 */
export function currentPhase(sheet: Partial<HearingSheet>): HearingPhase {
  if (missingFields(sheet, 1).length > 0) return "tier1";
  if (missingFields(sheet, 2).length > 0) return "tier2";
  return "complete";
}

/**
 * 次に聞くべき項目。すべて揃っていれば `null`。
 *
 * **Tier 1 を必ず先に埋める。** 計算できない状態のまま
 * 任意項目を聞き続けるのを防ぐ
 */
export function nextField(sheet: Partial<HearingSheet>): FieldKey | null {
  return missingFields(sheet, 1)[0] ?? missingFields(sheet, 2)[0] ?? null;
}

/**
 * 進捗。**LLMに言わせず、ここで算出する**（docs/requirements.md §3.1）。
 * 会話が長くなるとLLMの自己申告は当てにならなくなる
 */
export function progress(sheet: Partial<HearingSheet>): {
  filled: number;
  total: number;
} {
  const filled = HEARING_FIELDS.filter((f) => isFilled(sheet, f.key)).length;
  return { filled, total: HEARING_FIELDS.length };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
npm test -- src/lib/hearing/state.test.ts
```

期待: 18 passed

- [ ] **Step 5: コミット**

```bash
git add src/lib/hearing/state.ts src/lib/hearing/state.test.ts
git commit -m "feat: ヒアリングの未入力判定と進行を追加

0 と空配列は入力済みとして扱う。未入力と混同すると
「貯金0円」と答えた人に永久に聞き続けることになる。
進捗もLLMに言わせずここで算出する。"
```

---

### Task 4: 抽出結果のマージ

**Files:**
- Create: `src/lib/hearing/apply.ts`
- Test: `src/lib/hearing/apply.test.ts`

**Interfaces:**
- Consumes: `validateField`（Task 2）、`FieldKey`（Task 1）、`HearingSheet`
- Produces:
  - `type RejectedField = { key: string; reason: string }`
  - `applyExtraction(sheet, extracted): { sheet: Partial<HearingSheet>; rejected: RejectedField[] }`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/hearing/apply.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { applyExtraction } from "./apply";

const BASE: Partial<HearingSheet> = { currentAge: 40 };

describe("applyExtraction", () => {
  it("正しい値をシートに反映する", () => {
    const { sheet } = applyExtraction(BASE, { occupation: "employee" });
    expect(sheet.occupation).toBe("employee");
    expect(sheet.currentAge).toBe(40);
  });

  it("元のシートを書き換えない", () => {
    const original = { ...BASE };
    applyExtraction(BASE, { occupation: "employee" });
    expect(BASE).toEqual(original);
  });

  it("正規化された値が入る（小数は丸められる）", () => {
    const { sheet } = applyExtraction({}, { currentAge: 40.6 });
    expect(sheet.currentAge).toBe(41);
  });

  it("範囲外の値は捨てて理由を返す", () => {
    const { sheet, rejected } = applyExtraction(BASE, { currentAge: 200 });
    expect(sheet.currentAge).toBe(40); // 元の値のまま
    expect(rejected).toHaveLength(1);
    expect(rejected[0].key).toBe("currentAge");
    expect(rejected[0].reason).toContain("現在の年齢");
  });

  it("スキーマに無いキーは捨てて理由を返す", () => {
    // LLM が勝手な項目を返しうる
    const { sheet, rejected } = applyExtraction(BASE, { favoriteColor: "青" });
    expect(sheet).toEqual(BASE);
    expect(rejected.map((r) => r.key)).toContain("favoriteColor");
  });

  it("正しい項目と不正な項目が混ざっていても、正しい方は反映する", () => {
    const { sheet, rejected } = applyExtraction(BASE, {
      occupation: "employee",
      savings: -100,
    });
    expect(sheet.occupation).toBe("employee");
    expect(sheet.savings).toBeUndefined();
    expect(rejected).toHaveLength(1);
  });

  it("null や undefined の値は「未入力のまま」として無視する", () => {
    // LLM が「まだ分からない」を null で返すことがある。
    // 拒否ではないので rejected には入れない
    const { sheet, rejected } = applyExtraction(BASE, {
      occupation: null,
      savings: undefined,
    });
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("空の抽出結果は何も変えない", () => {
    const { sheet, rejected } = applyExtraction(BASE, {});
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("抽出結果が object でなければ何も変えない", () => {
    const { sheet, rejected } = applyExtraction(BASE, null);
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("既に入力済みの項目も上書きできる", () => {
    // 「やっぱり45歳でした」と言い直せる必要がある
    const { sheet } = applyExtraction(BASE, { currentAge: 45 });
    expect(sheet.currentAge).toBe(45);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
npm test -- src/lib/hearing/apply.test.ts
```

期待: FAIL

- [ ] **Step 3: 実装を書く**

`src/lib/hearing/apply.ts`:
```ts
import type { HearingSheet } from "@/lib/lifeplan/types";
import type { FieldKey } from "./fields";
import { validateField } from "./validate";

/** 受け入れられなかった項目と、その理由 */
export type RejectedField = { key: string; reason: string };

/**
 * LLMの抽出結果をシートにマージする（docs/requirements.md §3.2）。
 *
 * **不正な値は黙って捨てず、理由を返す。** §3.3 の通り Sonnet は
 * 不足パラメータを推測で埋めることがあり、その値はエラーではなく
 * 「もっともらしい嘘」として届く。捨てたことを呼び出し側が知り、
 * 会話で聞き直せるようにする
 *
 * `null` / `undefined` は「まだ分からない」の意味として扱い、
 * 拒否には数えない。LLMが不明を null で返してくるため
 */
export function applyExtraction(
  sheet: Partial<HearingSheet>,
  extracted: unknown,
): { sheet: Partial<HearingSheet>; rejected: RejectedField[] } {
  if (typeof extracted !== "object" || extracted === null) {
    return { sheet: { ...sheet }, rejected: [] };
  }

  const next: Partial<HearingSheet> = { ...sheet };
  const rejected: RejectedField[] = [];

  for (const [key, value] of Object.entries(extracted)) {
    // 「まだ分からない」は未入力のままにする。拒否ではない
    if (value === null || value === undefined) continue;

    const result = validateField(key as FieldKey, value);
    if (result.ok) {
      // 検証を通った値だけを入れる。値は正規化済み（小数は丸められている）
      (next as Record<string, unknown>)[key] = result.value;
    } else {
      rejected.push({ key, reason: result.reason });
    }
  }

  return { sheet: next, rejected };
}
```

- [ ] **Step 4: 全テストを通す**

```bash
npm test
npm run typecheck
npm run lint
```

期待: 既存99件＋今回の追加分がすべて pass、型・lint エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/lib/hearing/apply.ts src/lib/hearing/apply.test.ts
git commit -m "feat: LLMの抽出結果をシートにマージする

不正な値は黙って捨てず理由を返す。Sonnet は不足パラメータを
推測で埋めることがあり、その値はエラーではなく「もっともらしい嘘」
として届くため、捨てたことを会話側が知れる必要がある。"
```

---

## Phase 2b-1 完了条件

- [ ] `npm test` が全件 pass する（既存99件＋今回の追加分）
- [ ] `npm run typecheck` / `npm run lint` がエラーなし
- [ ] `src/lib/hearing/` が React にも Worker ランタイムにも依存していない
- [ ] **`0` と空配列が「入力済み」として扱われる**（未入力と混同していない）
- [ ] **Tier 1 が未入力の間は `nextField` が Tier 2 を返さない**
- [ ] 不正な抽出結果が理由付きで拒否され、正しい項目だけが反映される
- [ ] Worker も LLM 呼び出しも書いていない

## Phase 2b-2 への引き継ぎ

| 前提 | 状態 |
|---|---|
| ステートマシン | Phase 2b-1 で完了。Worker からもブラウザからも呼べる |
| **AI Gateway の Budget Limit** | **未設定。公開前の必須ゲート**（→ §7.1: 月$30 推奨） |
| Anthropic APIキー | 未取得（このプロジェクト専用のものを作る） |
| Worker と静的アセットの共存構成 | 未検証。`wrangler.jsonc` に `main` を足す形になる |
| Turnstile / Durable Object | 未着手 |
| チャットUI | 未着手。既存の `HearingForm` は残して併置する |
