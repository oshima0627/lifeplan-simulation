import { describe, expect, it } from "vitest";
import { newRowId } from "./id";

describe("newRowId", () => {
  it("空でない文字列を返す", () => {
    expect(newRowId()).not.toBe("");
    expect(typeof newRowId()).toBe("string");
  });

  it("呼ぶたびに異なるIDを返す", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newRowId()));
    expect(ids.size).toBe(1_000);
  });

  it("crypto.randomUUID が使えない環境でも動く", () => {
    const original = globalThis.crypto;
    // randomUUID を持たない crypto に差し替える
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });
    try {
      const ids = new Set(Array.from({ length: 100 }, () => newRowId()));
      expect(ids.size).toBe(100);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});
