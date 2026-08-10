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
