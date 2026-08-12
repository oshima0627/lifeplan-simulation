import { describe, expect, it } from "vitest";
import { hashToken, newSessionToken, sessionExpiryIso, SESSION_TTL_DAYS } from "./session";

describe("newSessionToken", () => {
  it("毎回違う値になる", () => {
    expect(newSessionToken()).not.toBe(newSessionToken());
  });

  it("base64url で十分な長さがある（32バイト＝43文字）", () => {
    const t = newSessionToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("同じ入力なら同じハッシュ", async () => {
    expect(await hashToken("abc")).toBe(await hashToken("abc"));
  });

  it("違う入力なら違うハッシュ", async () => {
    expect(await hashToken("abc")).not.toBe(await hashToken("abd"));
  });

  it("SHA-256 の16進64文字", async () => {
    expect(await hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("生のトークンを含まない（DBが漏れても復元できないこと）", async () => {
    const token = newSessionToken();
    expect(await hashToken(token)).not.toContain(token);
  });
});

describe("sessionExpiryIso", () => {
  it("基準から30日後のISO文字列", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExpiryIso(from)).toBe("2026-01-31T00:00:00.000Z");
    expect(SESSION_TTL_DAYS).toBe(30);
  });
});
