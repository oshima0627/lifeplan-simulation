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
