import { describe, expect, it } from "vitest";
import { DEFAULT_PENSION_START_AGE, LIFE_EXPECTANCY_AGE } from "@/constants/lifeplan";
import {
  isEventAgeOutOfRange,
  isPensionStartAgeInvalid,
  isRetirementAgeInvalid,
} from "./guards";
import type { HearingSheet, LifeEvent } from "./types";

const BASE: HearingSheet = {
  currentAge: 40,
  occupation: "employee",
  householdNetIncome: 6_000_000,
  annualLivingCost: 3_600_000,
  savings: 3_000_000,
  investments: 3_000_000,
  retirementAge: 65,
};

describe("isRetirementAgeInvalid", () => {
  it("リタイア予定年齢が現在の年齢を下回るとtrue", () => {
    expect(isRetirementAgeInvalid({ ...BASE, currentAge: 66, retirementAge: 65 })).toBe(true);
  });

  it("リタイア予定年齢が現在の年齢を上回るとfalse", () => {
    expect(isRetirementAgeInvalid({ ...BASE, currentAge: 40, retirementAge: 65 })).toBe(false);
  });

  it("境界: 等しいときはfalse", () => {
    expect(isRetirementAgeInvalid({ ...BASE, currentAge: 65, retirementAge: 65 })).toBe(false);
  });
});

describe("isPensionStartAgeInvalid", () => {
  it("年金受給開始年齢が現在の年齢を下回るとtrue", () => {
    expect(
      isPensionStartAgeInvalid({ ...BASE, currentAge: 70, retirementAge: 70, pensionStartAge: 65 }),
    ).toBe(true);
  });

  it("年金受給開始年齢が現在の年齢を上回るとfalse", () => {
    expect(
      isPensionStartAgeInvalid({ ...BASE, currentAge: 40, pensionStartAge: 65 }),
    ).toBe(false);
  });

  it("境界: 等しいときはfalse", () => {
    expect(
      isPensionStartAgeInvalid({ ...BASE, currentAge: 65, retirementAge: 65, pensionStartAge: 65 }),
    ).toBe(false);
  });

  it("pensionStartAge省略時はDEFAULT_PENSION_START_AGEを使う", () => {
    expect(
      isPensionStartAgeInvalid({ ...BASE, currentAge: DEFAULT_PENSION_START_AGE + 1 }),
    ).toBe(true);
    expect(
      isPensionStartAgeInvalid({ ...BASE, currentAge: DEFAULT_PENSION_START_AGE }),
    ).toBe(false);
  });
});

describe("isEventAgeOutOfRange", () => {
  const event: LifeEvent = { id: "e1", age: 50, amount: 1_000_000, label: "住宅購入" };

  it("イベント年齢が現在の年齢を下回るとtrue", () => {
    expect(isEventAgeOutOfRange({ ...event, age: 30 }, 40)).toBe(true);
  });

  it("イベント年齢がLIFE_EXPECTANCY_AGEを上回るとtrue", () => {
    expect(isEventAgeOutOfRange({ ...event, age: LIFE_EXPECTANCY_AGE + 1 }, 40)).toBe(true);
  });

  it("イベント年齢が範囲内ならfalse", () => {
    expect(isEventAgeOutOfRange({ ...event, age: 50 }, 40)).toBe(false);
  });

  it("境界: 現在の年齢と等しいときはfalse", () => {
    expect(isEventAgeOutOfRange({ ...event, age: 40 }, 40)).toBe(false);
  });

  it("境界: LIFE_EXPECTANCY_AGEと等しいときはfalse", () => {
    expect(isEventAgeOutOfRange({ ...event, age: LIFE_EXPECTANCY_AGE }, 40)).toBe(false);
  });
});
