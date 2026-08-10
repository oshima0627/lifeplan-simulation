import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import { buildEducationEvents } from "./education";
import type { HearingSheet, LifeEvent, ScenarioAssumption, ScenarioResult, YearRow } from "./types";

/**
 * 1シナリオぶんの年次キャッシュフローを計算する。
 *
 * 計算仕様（docs/requirements.md §5.1, §5.1.1）:
 *   収入 = 給与（リタイア前のみ、昇給率で毎年増える）
 *        + 年金（受給開始年齢以降、(インフレ率 − 年金スライド幅) で毎年増える）
 *        + 退職金（リタイアした年のみ、名目固定）
 *   支出 = 基本生活費（インフレ率で毎年増える）
 *        + その年のイベント費（教育費・任意イベント。インフレ率で毎年増える）
 *   収支 = 収入 - 支出
 *
 * インフレ調整の対象は項目ごとに異なる（§5.1.1）。誤ると誤差の向きが項目ごとに
 * 逆になり相殺しないため、この区別を崩さないこと:
 * - 基本生活費・教育費・任意イベントは物価に連動するのでインフレ率で調整する
 * - 年金は「今日の購買力」で入力されるためインフレ率で調整するが、
 *   マクロ経済スライドの目減りを織り込みシナリオごとのスライド幅ぶん割り引く
 * - 退職金は名目額で定められる規程が多く、調整すると根拠のない仮定になるので据え置く
 * - 給与は昇給率で調整する（インフレ率とは別の変数）
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
  const pensionSlideRate = assumption.pensionSlidePct / 100;
  // 年金改定率 = max(0, インフレ率 − スライド幅)。マクロ経済スライドは物価上昇率を
  // 下回る改定を行うが、下回った分が年金を目減りさせることはあっても、
  // インフレ率そのものを上回って増えることはない（docs/requirements.md §5.1.1）
  const pensionRate = Math.max(0, inflationRate - pensionSlideRate);
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
    // 年金は「今日の購買力」で入力されているため、経過年数ぶん年金改定率で増やす
    const pension =
      age >= pensionStartAge ? (sheet.pensionAnnual ?? 0) * (1 + pensionRate) ** elapsed : 0;
    // 退職金はリタイアした年に一度だけ、かつ名目固定（インフレ調整しない）。
    // 退職金規程は名目額で定められることが多く、過小評価は保守側に振れるため
    // 「楽観値を使わない」原則に沿う（docs/requirements.md §5.1.1）
    const lumpSum = age === sheet.retirementAge ? (sheet.retirementLumpSum ?? 0) : 0;
    const income = salary + pension + lumpSum;

    // --- 支出 ---
    const living = sheet.annualLivingCost * (1 + inflationRate) ** elapsed;
    // ライフイベント費（教育費・任意イベント）は入力時点の金額なので、
    // 発生年までインフレ率で調整する（今の価格で3,000万円の家を20年後に買えば、
    // その時の価格は違う）
    const yearEvents = eventsByAge.get(age) ?? [];
    const eventCostToday = yearEvents.reduce((sum, e) => sum + e.amount, 0);
    const eventCost = eventCostToday * (1 + inflationRate) ** elapsed;
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
