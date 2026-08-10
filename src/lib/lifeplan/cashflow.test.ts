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
  pensionSlidePct: 0,
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

  it("投資は運用してから収支を足す（順序が逆だと年末に入れた分にも利回りがつく）", () => {
    const result = simulateCashflow(BASE, { ...FLAT, returnPct: 10 });
    // 正しい順序: 500万 × 1.10 = 550万 → 黒字200万を足して 750万
    // 逆の順序なら (500万 + 200万) × 1.10 = 770万 になり、この期待値は落ちる
    expect(result.rows[0].investments).toBe(7_500_000);
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
    const sheet: HearingSheet = { ...BASE, children: [{ id: "c1", age: 6, path: "public" }] };
    const result = simulateCashflow(sheet, FLAT);
    const first = result.rows[0];
    expect(first.expense).toBeGreaterThan(4_000_000);
    expect(first.events.some((e) => e.includes("小学校"))).toBe(true);
  });

  it("任意イベントもその年の支出に乗る", () => {
    const sheet: HearingSheet = {
      ...BASE,
      customEvents: [{ id: "e1", age: 45, amount: 30_000_000, label: "住宅購入" }],
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
    // BASE をそのまま使ってはいけない。年金も退職金も無いため
    // リタイア後は年400万円の赤字が31年続き、79歳で必ず枯渇する
    // （65歳時点の資産5,800万円 ÷ 年400万円 ≒ 14.5年）。
    // 「尽きない」ことを確かめるには、それを吸収できる資産が要る
    const sheet: HearingSheet = { ...BASE, investments: 500_000_000 };
    const result = simulateCashflow(sheet, FLAT);
    expect(result.depletionAge).toBeNull();
    expect(result.temporaryShortfall).toBe(false);
  });

  it("一時的にマイナスへ落ちても95歳までに回復すれば depletionAge は null で temporaryShortfall が true になる", () => {
    // 90歳の時点で大きな買い物（2,000万円）をして一時的にマイナスへ落ちるが、
    // 黒字（年500万）が続くので93歳には回復し、95歳時点ではプラスで終える
    const sheet: HearingSheet = {
      currentAge: 90,
      occupation: "employee",
      householdNetIncome: 8_000_000,
      annualLivingCost: 3_000_000,
      savings: 0,
      investments: 0,
      retirementAge: 999, // 試算範囲内では退職しない
      customEvents: [{ id: "e1", age: 91, amount: 20_000_000, label: "住宅購入" }],
    };
    const result = simulateCashflow(sheet, FLAT);
    // 91歳・92歳は総資産がマイナスになるが、94歳以降にプラスへ回復する
    expect(result.rows.find((r) => r.age === 91)!.total).toBeLessThan(0);
    expect(result.rows.find((r) => r.age === 94)!.total).toBeGreaterThan(0);
    expect(result.depletionAge).toBeNull();
    expect(result.temporaryShortfall).toBe(true);
  });

  it("マイナス→プラス→マイナスと動いても、95歳まで回復しなければ最後の連続マイナス区間の先頭を depletionAge とする", () => {
    // 41歳で大きな買い物をして一時的にマイナスへ落ちるが、リタイア前の黒字で
    // 一度プラスに回復する。しかしリタイア後は年金が無く赤字が続くため、
    // 46歳から95歳まで一度もプラスに戻らない ＝ そこが実質的な枯渇年齢になる
    const sheet: HearingSheet = {
      currentAge: 40,
      occupation: "employee",
      householdNetIncome: 8_000_000,
      annualLivingCost: 3_000_000,
      savings: 0,
      investments: 0,
      retirementAge: 45,
      customEvents: [{ id: "e1", age: 41, amount: 20_000_000, label: "住宅購入" }],
    };
    const result = simulateCashflow(sheet, FLAT);

    // 一時的なマイナス（41歳付近）
    expect(result.rows.find((r) => r.age === 41)!.total).toBeLessThan(0);
    // リタイア前に一度プラスへ回復する
    expect(result.rows.find((r) => r.age === 44)!.total).toBeGreaterThan(0);
    // リタイア後は年金が無いので赤字が続き、二度と回復しない
    expect(result.rows.at(-1)!.total).toBeLessThan(0);

    expect(result.depletionAge).toBe(46);
    expect(result.temporaryShortfall).toBe(false);
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

describe("インフレ調整（docs/requirements.md §5.1.1）", () => {
  it("年金は「インフレ率 − スライド幅」の改定率で毎年増える", () => {
    const sheet: HearingSheet = {
      ...BASE,
      pensionAnnual: 2_000_000,
      pensionStartAge: BASE.currentAge, // 即時受給にして経過年数の効果だけを見る
    };
    const assumption: ScenarioAssumption = {
      ...FLAT,
      inflationPct: 3,
      pensionSlidePct: 1, // 年金改定率 = 3% - 1% = 2%
    };
    const result = simulateCashflow(sheet, assumption);
    const atElapsed5 = result.rows.find((r) => r.age === BASE.currentAge + 5)!;
    const expectedPension = 2_000_000 * 1.02 ** 5;
    // raisePct は 0 なので給与は一定。合算後に丸められるため合算値で比較する
    expect(atElapsed5.income).toBe(Math.round(BASE.householdNetIncome + expectedPension));
  });

  it("年金改定率はマイナスにならない（スライド幅がインフレ率を上回っても年金は目減りしない）", () => {
    const sheet: HearingSheet = {
      ...BASE,
      pensionAnnual: 2_000_000,
      pensionStartAge: BASE.currentAge,
    };
    const assumption: ScenarioAssumption = {
      ...FLAT,
      inflationPct: 0.5,
      pensionSlidePct: 1, // インフレ率を上回るスライド幅
    };
    const result = simulateCashflow(sheet, assumption);
    const atElapsed5 = result.rows.find((r) => r.age === BASE.currentAge + 5)!;
    // 改定率 = max(0, 0.5% - 1%) = 0 → 年金は名目のまま
    expect(atElapsed5.income).toBe(BASE.householdNetIncome + 2_000_000);
  });

  it("年金スライド幅が大きいシナリオほど年金の伸びは小さい", () => {
    const sheet: HearingSheet = {
      ...BASE,
      pensionAnnual: 2_000_000,
      pensionStartAge: BASE.currentAge,
    };
    const lowSlide = simulateCashflow(sheet, { ...FLAT, inflationPct: 3, pensionSlidePct: 0 });
    const highSlide = simulateCashflow(sheet, { ...FLAT, inflationPct: 3, pensionSlidePct: 1 });
    const ageAt10 = BASE.currentAge + 10;
    const lowIncome = lowSlide.rows.find((r) => r.age === ageAt10)!.income;
    const highIncome = highSlide.rows.find((r) => r.age === ageAt10)!.income;
    expect(lowIncome).toBeGreaterThan(highIncome);
  });

  it("任意イベントの費用は発生時点までインフレ率で調整される", () => {
    const sheet: HearingSheet = {
      ...BASE,
      customEvents: [{ id: "e1", age: 45, amount: 30_000_000, label: "住宅購入" }],
    };
    const result = simulateCashflow(sheet, { ...FLAT, inflationPct: 2 });
    const at45 = result.rows.find((r) => r.age === 45)!;
    const elapsed = 45 - BASE.currentAge;
    const expectedLiving = BASE.annualLivingCost * 1.02 ** elapsed;
    const expectedEventCost = 30_000_000 * 1.02 ** elapsed;
    expect(at45.expense).toBe(Math.round(expectedLiving + expectedEventCost));
  });

  it("教育費イベントの費用も発生時点までインフレ率で調整される", () => {
    const sheet: HearingSheet = { ...BASE, children: [{ id: "c1", age: 6, path: "public" }] };
    const flatResult = simulateCashflow(sheet, FLAT);
    const inflatedResult = simulateCashflow(sheet, { ...FLAT, inflationPct: 2 });
    // 発生は初年度（elapsed=0）なので、まずは将来年での差で確認する必要がある。
    // 6歳の小学校入学は初年度に発生するため、代わりに中学入学（elapsed=6）で比較する
    const ageAtJunior = BASE.currentAge + (12 - 6);
    const flatEventCost =
      flatResult.rows.find((r) => r.age === ageAtJunior)!.expense -
      BASE.annualLivingCost;
    const inflatedRow = inflatedResult.rows.find((r) => r.age === ageAtJunior)!;
    const elapsed = ageAtJunior - BASE.currentAge;
    const expectedLiving = BASE.annualLivingCost * 1.02 ** elapsed;
    const expectedEventCost = flatEventCost * 1.02 ** elapsed;
    expect(inflatedRow.expense).toBe(Math.round(expectedLiving + expectedEventCost));
  });

  it("退職金は名目固定で、インフレ率が上がっても増減しない", () => {
    const sheet: HearingSheet = { ...BASE, retirementLumpSum: 20_000_000 };
    const flatLump = simulateCashflow(sheet, FLAT);
    const inflatedLump = simulateCashflow(sheet, { ...FLAT, inflationPct: 5 });
    // リタイア年は給与が0・年金未設定のため、収入 = 退職金そのもの
    const atRetirementFlat = flatLump.rows.find((r) => r.age === sheet.retirementAge)!;
    const atRetirementInflated = inflatedLump.rows.find((r) => r.age === sheet.retirementAge)!;
    expect(atRetirementFlat.income).toBe(20_000_000);
    expect(atRetirementInflated.income).toBe(20_000_000);
  });
});
