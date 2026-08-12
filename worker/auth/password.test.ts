import { describe, expect, it } from "vitest";
import {
  hashClientKey,
  readClientKeyInput,
  storedKdfVersion,
  verifyClientKey,
} from "./password";

const KEY = "a".repeat(43);
const OTHER = "b".repeat(43);

describe("hashClientKey / verifyClientKey", () => {
  it("保存形式が pbkdf2c-v<版>$<ソルト>$<ダイジェスト>", async () => {
    const stored = await hashClientKey(KEY, 1);
    expect(stored).toMatch(/^pbkdf2c-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("同じ鍵でも毎回違うハッシュになる（ソルトが乱数）", async () => {
    expect(await hashClientKey(KEY, 1)).not.toBe(await hashClientKey(KEY, 1));
  });

  it("正しい鍵なら検証が通る", async () => {
    expect(await verifyClientKey(KEY, await hashClientKey(KEY, 1))).toBe(true);
  });

  it("違う鍵なら検証が落ちる", async () => {
    expect(await verifyClientKey(OTHER, await hashClientKey(KEY, 1))).toBe(false);
  });

  it("壊れた保存値では常に false（例外を投げない）", async () => {
    expect(await verifyClientKey(KEY, "")).toBe(false);
    expect(await verifyClientKey(KEY, "garbage")).toBe(false);
    expect(await verifyClientKey(KEY, "pbkdf2c-v1$only-two-parts")).toBe(false);
    expect(await verifyClientKey(KEY, "notascheme-v1$aaa$bbb")).toBe(false);
  });
});

describe("storedKdfVersion", () => {
  it("保存値から版を読める", async () => {
    expect(storedKdfVersion(await hashClientKey(KEY, 1))).toBe(1);
  });

  it("壊れた保存値では null", () => {
    expect(storedKdfVersion("garbage")).toBeNull();
  });
});

describe("定数時間比較のフォールバック", () => {
  // 注: base64url 43文字は32バイト（256bit）を表すが、43文字目（末尾）は
  // 6bit中2bitがデコード時に切り捨てられるため、末尾1文字だけを変えても
  // 実際のバイト列が変わらない場合がある（base64 のパディング特性）。
  // そのため「1バイトだけ違う」検証には、必ずバイトへ反映される位置（末尾
  // から2文字目・41番目）を使う。

  it("1バイトだけ違う値を正しく弾く（早期returnで通り抜けない）", async () => {
    const stored = await hashClientKey(KEY, 1);
    // KEY の末尾から2文字目だけを変えた鍵（デコード結果が確実に1バイト変わる）
    const almost = `${"a".repeat(41)}b${"a"}`;
    expect(await verifyClientKey(almost, stored)).toBe(false);
  });

  it("先頭バイトが違う場合も末尾バイトが違う場合も等しく false", async () => {
    const stored = await hashClientKey(KEY, 1);
    expect(await verifyClientKey(`b${"a".repeat(42)}`, stored)).toBe(false);
    expect(await verifyClientKey(`${"a".repeat(41)}b${"a"}`, stored)).toBe(false);
  });
});

describe("readClientKeyInput", () => {
  it("正しい形なら受け付ける", () => {
    expect(readClientKeyInput({ key: KEY, kdfVersion: 1 })).toEqual({
      key: KEY,
      kdfVersion: 1,
    });
  });

  it("鍵の形が不正なら null", () => {
    expect(readClientKeyInput({ key: "short", kdfVersion: 1 })).toBeNull();
    expect(readClientKeyInput({ key: 123, kdfVersion: 1 })).toBeNull();
  });

  it("未知の版なら null", () => {
    expect(readClientKeyInput({ key: KEY, kdfVersion: 999 })).toBeNull();
    expect(readClientKeyInput({ key: KEY, kdfVersion: "1" })).toBeNull();
  });

  it("欠けていれば null", () => {
    expect(readClientKeyInput({})).toBeNull();
  });
});
