import { describe, expect, it } from "vitest";
import type { HearingSheet } from "@/lib/lifeplan/types";
import { applyExtraction } from "./apply";

const BASE: Partial<HearingSheet> = { currentAge: 40 };

describe("applyExtraction", () => {
  it("正しい値をシートに反映する", () => {
    const { sheet } = applyExtraction(BASE, { occupation: "employee" });
    expect(sheet.occupation).toBe("employee");
    expect(sheet.currentAge).toBe(40);
  });

  it("元のシートを書き換えない", () => {
    const original = { ...BASE };
    applyExtraction(BASE, { occupation: "employee" });
    expect(BASE).toEqual(original);
  });

  it("正規化された値が入る（小数は丸められる）", () => {
    const { sheet } = applyExtraction({}, { currentAge: 40.6 });
    expect(sheet.currentAge).toBe(41);
  });

  it("範囲外の値は捨てて理由を返す", () => {
    const { sheet, rejected } = applyExtraction(BASE, { currentAge: 200 });
    expect(sheet.currentAge).toBe(40); // 元の値のまま
    expect(rejected).toHaveLength(1);
    expect(rejected[0].key).toBe("currentAge");
    expect(rejected[0].reason).toContain("現在の年齢");
  });

  it("スキーマに無いキーは捨てて理由を返す", () => {
    // LLM が勝手な項目を返しうる
    const { sheet, rejected } = applyExtraction(BASE, { favoriteColor: "青" });
    expect(sheet).toEqual(BASE);
    expect(rejected.map((r) => r.key)).toContain("favoriteColor");
  });

  it("正しい項目と不正な項目が混ざっていても、正しい方は反映する", () => {
    const { sheet, rejected } = applyExtraction(BASE, {
      occupation: "employee",
      savings: -100,
    });
    expect(sheet.occupation).toBe("employee");
    expect(sheet.savings).toBeUndefined();
    expect(rejected).toHaveLength(1);
  });

  it("null や undefined の値は「未入力のまま」として無視する", () => {
    // LLM が「まだ分からない」を null で返すことがある。
    // 拒否ではないので rejected には入れない
    const { sheet, rejected } = applyExtraction(BASE, {
      occupation: null,
      savings: undefined,
    });
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("空の抽出結果は何も変えない", () => {
    const { sheet, rejected } = applyExtraction(BASE, {});
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("抽出結果が object でなければ何も変えない", () => {
    const { sheet, rejected } = applyExtraction(BASE, null);
    expect(sheet).toEqual(BASE);
    expect(rejected).toEqual([]);
  });

  it("既に入力済みの項目も上書きできる", () => {
    // 「やっぱり45歳でした」と言い直せる必要がある
    const { sheet } = applyExtraction(BASE, { currentAge: 45 });
    expect(sheet.currentAge).toBe(45);
  });

  it("不正な要素を含む children は理由付きで拒否し、黙ってマージしない", () => {
    // §3.3: Sonnet が欠損パラメータを null 混じりの配列などで
    // もっともらしく埋めてくることがある。ここが最後の関門
    const { sheet, rejected } = applyExtraction(BASE, {
      children: [{ age: 10, path: "public" }, null],
    });
    expect(sheet.children).toBeUndefined();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].key).toBe("children");
    expect(rejected[0].reason).toContain("2件目");
  });
});
