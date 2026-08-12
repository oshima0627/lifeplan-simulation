import { describe, expect, it } from "vitest";
import {
  deriveClientKey,
  fromBase64Url,
  isKnownKdfVersion,
  isValidClientKey,
  KDF_VERSION,
  toBase64Url,
} from "./kdf";

describe("base64url", () => {
  it("往復して元に戻る", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it("URLで問題になる文字を含まない", () => {
    const bytes = new Uint8Array([251, 255, 190]);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
});

describe("deriveClientKey", () => {
  it("同じメール・同じパスワードなら同じ鍵になる", async () => {
    const a = await deriveClientKey("foo@example.com", "correct horse battery");
    const b = await deriveClientKey("foo@example.com", "correct horse battery");
    expect(a).toBe(b);
  });

  it("メールの大文字小文字が違っても同じ鍵になる（正規化が効いている）", async () => {
    const a = await deriveClientKey("Foo@Example.COM", "correct horse battery");
    const b = await deriveClientKey("foo@example.com", "correct horse battery");
    expect(a).toBe(b);
  });

  it("パスワードが違えば違う鍵になる", async () => {
    const a = await deriveClientKey("foo@example.com", "aaaaaaaa");
    const b = await deriveClientKey("foo@example.com", "bbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("メールが違えば違う鍵になる（ソルトがメール由来）", async () => {
    const a = await deriveClientKey("foo@example.com", "aaaaaaaa");
    const b = await deriveClientKey("bar@example.com", "aaaaaaaa");
    expect(a).not.toBe(b);
  });

  it("形式が不正なメールでは例外を投げる", async () => {
    await expect(deriveClientKey("not-an-email", "aaaaaaaa")).rejects.toThrow();
  });

  it("鍵は256bitを base64url にした43文字", async () => {
    const key = await deriveClientKey("foo@example.com", "aaaaaaaa");
    expect(key).toHaveLength(43);
    expect(isValidClientKey(key)).toBe(true);
  });
}, 60_000);

describe("isValidClientKey", () => {
  it("43文字の base64url だけを受け付ける", () => {
    expect(isValidClientKey("a".repeat(43))).toBe(true);
    expect(isValidClientKey("a".repeat(42))).toBe(false);
    expect(isValidClientKey("a".repeat(44))).toBe(false);
    expect(isValidClientKey(`${"a".repeat(42)}+`)).toBe(false);
    expect(isValidClientKey(123)).toBe(false);
  });
});

describe("isKnownKdfVersion", () => {
  it("既知の版だけを受け付ける", () => {
    expect(isKnownKdfVersion(KDF_VERSION)).toBe(true);
    expect(isKnownKdfVersion(999)).toBe(false);
    expect(isKnownKdfVersion("1")).toBe(false);
  });
});
