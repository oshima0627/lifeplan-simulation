import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("小文字にして前後の空白を落とす", () => {
    expect(normalizeEmail("  Foo@Example.COM  ")).toBe("foo@example.com");
  });

  it("文字列でなければ null", () => {
    expect(normalizeEmail(123)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("形式が不正なら null", () => {
    expect(normalizeEmail("foo")).toBeNull();
    expect(normalizeEmail("foo@")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("foo@example")).toBeNull();
    expect(normalizeEmail("a b@example.com")).toBeNull();
  });

  it("254文字を超えるものは null", () => {
    const long = `${"a".repeat(250)}@example.com`;
    expect(normalizeEmail(long)).toBeNull();
  });

  it("同じアドレスの大文字小文字違いが同じ結果になる（アカウント二重作成を防ぐ要）", () => {
    expect(normalizeEmail("A@X.com")).toBe(normalizeEmail("a@x.com"));
  });
});
