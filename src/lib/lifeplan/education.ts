import {
  EDUCATION_ANNUAL_COST,
  EDUCATION_STAGES,
  LIFE_EXPECTANCY_AGE,
  UNIVERSITY_ENTRANCE_FEE,
} from "@/constants/lifeplan";
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
 *
 * id は `crypto.randomUUID` 等のランダム採番ではなく、子供のインデックス・進学段階・
 * 子供の年齢から一意に導出する。この関数は入力を変えるたびフォームの再計算で毎回
 * 呼ばれるため、ランダムIDだと同じ入力でも呼ぶたびに違う出力になり計算エンジンが
 * 純粋関数でなくなる。生成される行は「子供×進学段階×年齢」の組み合わせで一意になる
 * ことが構造的に保証されているため、内容から導出しても衝突しない
 * （§4.1 の「内容から導出しない」はユーザーが自由入力する行の話で、
 * こちらは自動生成される行なので前提が異なる。docs/requirements.md §4.1, Finding 5）
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
          id: `edu-${index}-${stage}-${childAge}`,
          age: parentAge,
          amount: EDUCATION_ANNUAL_COST[child.path][stage],
          label: `${who} ${label}`,
        });

        // 大学は入学年に入学料が別途かかる
        if (stage === "university" && childAge === startAge) {
          events.push({
            id: `edu-${index}-${stage}-${childAge}-entrance`,
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
