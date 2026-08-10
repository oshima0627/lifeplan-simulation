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
  /**
   * 年金のインフレ調整で、インフレ率から差し引くスライド幅（%ポイント）。
   * 年金改定率 = max(0, インフレ率 − このスライド幅)。
   *
   * ねんきんネットの見込額は「今日の購買力」で表示されるため、名目固定にすると
   * 「公的年金が将来ほぼ無価値になる」と主張することになる。ただし満額をインフレ率で
   * 連動させもしない — マクロ経済スライドは物価上昇率を下回る改定を行うため、
   * その分を織り込む変数として置く（docs/requirements.md §5.1.1）。
   *
   * ⚠️ 過去のマクロ経済スライドの調整率をもとにした概算であり、制度上保証された値ではない
   */
  pensionSlidePct: number;
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
