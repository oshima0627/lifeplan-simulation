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
