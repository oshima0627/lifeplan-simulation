import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
  UNIVERSITY_ENTRANCE_FEE,
} from "@/constants/lifeplan";
import { newRowId } from "@/lib/id";
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
          id: newRowId(),
          age: parentAge,
          amount: EDUCATION_ANNUAL_COST[child.path][stage],
          label: `${who} ${label}`,
        });

        // 大学は入学年に入学料が別途かかる
        if (stage === "university" && childAge === startAge) {
          events.push({
            id: newRowId(),
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
