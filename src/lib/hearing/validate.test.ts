import { describe, expect, it } from "vitest";
import { validateField } from "./validate";

describe("validateField — 数値項目", () => {
  it("範囲内の整数を受け入れる", () => {
    expect(validateField("currentAge", 40)).toEqual({ ok: true, value: 40 });
  });

  it("下限・上限ちょうどを受け入れる", () => {
    expect(validateField("currentAge", 18).ok).toBe(true);
    expect(validateField("currentAge", 94).ok).toBe(true);
  });

  it("範囲外を拒否する", () => {
    expect(validateField("currentAge", 17).ok).toBe(false);
    expect(validateField("currentAge", 95).ok).toBe(false);
  });

  it("小数を整数に丸めてから範囲を見る", () => {
    // LLMが「6歳半」を 6.5 として返しうる。丸めずに通すと
    // 教育費の年次ループと噛み合わず、費用が丸ごと消える
    expect(validateField("currentAge", 40.4)).toEqual({ ok: true, value: 40 });
    expect(validateField("currentAge", 40.6)).toEqual({ ok: true, value: 41 });
  });

  it("NaN と Infinity を拒否する", () => {
    expect(validateField("currentAge", NaN).ok).toBe(false);
    expect(validateField("currentAge", Infinity).ok).toBe(false);
    expect(validateField("currentAge", -Infinity).ok).toBe(false);
  });

  it("数値でない値を拒否する", () => {
    expect(validateField("currentAge", "40").ok).toBe(false);
    expect(validateField("currentAge", null).ok).toBe(false);
    expect(validateField("currentAge", undefined).ok).toBe(false);
    expect(validateField("currentAge", {}).ok).toBe(false);
  });

  it("拒否したときは日本語の理由を返す", () => {
    const r = validateField("currentAge", 200);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("現在の年齢");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("validateField — enum項目", () => {
  it("定義済みの値を受け入れる", () => {
    expect(validateField("occupation", "employee")).toEqual({
      ok: true,
      value: "employee",
    });
  });

  it("定義外の値を拒否する", () => {
    // Sonnet は不足パラメータを推測で埋めることがある（§3.3）。
    // enum で縛っていても、抽出結果の検証で最終的に弾く
    expect(validateField("occupation", "会社役員").ok).toBe(false);
    expect(validateField("occupation", "").ok).toBe(false);
    expect(validateField("occupation", 1).ok).toBe(false);
  });
});

describe("validateField — リスト項目", () => {
  it("配列を受け入れる", () => {
    expect(validateField("children", []).ok).toBe(true);
  });

  it("配列でない値を拒否する", () => {
    expect(validateField("children", "2人").ok).toBe(false);
    expect(validateField("children", 2).ok).toBe(false);
    expect(validateField("children", null).ok).toBe(false);
  });

  it("空の配列は「子供なし」として受け入れる", () => {
    // 未入力ではなく「0人と回答済み」の意味（状態機械の意味論）
    expect(validateField("children", []).ok).toBe(true);
    expect(validateField("customEvents", []).ok).toBe(true);
  });

  describe("children — 要素の形の検証", () => {
    it("正しい形の要素からなる配列を受け入れる", () => {
      const r = validateField("children", [
        { age: 10, path: "public" },
        { age: 15, path: "private" },
      ]);
      expect(r.ok).toBe(true);
    });

    it("id 付きの要素も受け入れる（文字列であれば）", () => {
      const r = validateField("children", [{ id: "abc", age: 10, path: "public" }]);
      expect(r.ok).toBe(true);
    });

    it("null 要素を拒否する", () => {
      expect(validateField("children", [null]).ok).toBe(false);
    });

    it("undefined 要素を拒否する", () => {
      expect(validateField("children", [undefined]).ok).toBe(false);
    });

    it("必須キーが欠けた要素を拒否する", () => {
      expect(validateField("children", [{ age: 10 }]).ok).toBe(false); // path が無い
      expect(validateField("children", [{ path: "public" }]).ok).toBe(false); // age が無い
    });

    it("型の違う値を拒否する", () => {
      expect(validateField("children", [{ age: "10", path: "public" }]).ok).toBe(false);
    });

    it("path が不正な列挙値の要素を拒否する", () => {
      expect(
        validateField("children", [{ age: 10, path: "international" }]).ok,
      ).toBe(false);
    });

    it("拒否理由に該当インデックスを含む", () => {
      const r = validateField("children", [
        { age: 10, path: "public" },
        { age: 10, path: "invalid" },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("2件目");
      }
    });
  });

  describe("customEvents — 要素の形の検証", () => {
    it("正しい形の要素からなる配列を受け入れる", () => {
      const r = validateField("customEvents", [
        { age: 35, amount: 3_000_000, label: "住宅購入" },
      ]);
      expect(r.ok).toBe(true);
    });

    it("null 要素を拒否する", () => {
      expect(validateField("customEvents", [null]).ok).toBe(false);
    });

    it("undefined 要素を拒否する", () => {
      expect(validateField("customEvents", [undefined]).ok).toBe(false);
    });

    it("必須キーが欠けた要素を拒否する", () => {
      expect(
        validateField("customEvents", [{ age: 35, label: "住宅購入" }]).ok,
      ).toBe(false); // amount が無い
    });

    it("amount が数値でない要素を拒否する", () => {
      // LLMが「3000万」のような文字列で返すことがある
      expect(
        validateField("customEvents", [{ age: 35, amount: "3000万", label: "住宅購入" }])
          .ok,
      ).toBe(false);
    });

    it("age が数値でない要素を拒否する", () => {
      expect(
        validateField("customEvents", [{ age: "10", amount: 1000, label: "x" }]).ok,
      ).toBe(false);
    });

    it("拒否理由に該当インデックスを含む", () => {
      const r = validateField("customEvents", [
        { age: 35, amount: 1000, label: "ok" },
        { age: 35, amount: "bad", label: "ng" },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain("2件目");
      }
    });
  });
});

describe("validateField — 未知のキー", () => {
  it("未知のキーは拒否する（例外にしない）", () => {
    // LLM がスキーマに無いキーを返しうる。呼び出し側を落とさず、
    // 拒否として扱って捨てる
    // @ts-expect-error 意図的に未定義のキーを渡す
    expect(validateField("nonexistentField", 1).ok).toBe(false);
  });
});
