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
