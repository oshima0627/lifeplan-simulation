import { describe, expect, it } from "vitest";
import { buildSetCookie, readCookie, SESSION_COOKIE } from "./cookies";

describe("buildSetCookie", () => {
  it("httpOnly と SameSite=Lax と Path=/ を必ず付ける", () => {
    const v = buildSetCookie(SESSION_COOKIE, "abc", 100, true);
    expect(v).toContain("HttpOnly");
    expect(v).toContain("SameSite=Lax");
    expect(v).toContain("Path=/");
  });

  it("secure が true なら Secure を付ける", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 100, true)).toContain("Secure");
  });

  it("secure が false なら Secure を付けない（ローカル開発用）", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 100, false)).not.toContain("Secure");
  });

  it("Max-Age を秒で入れる", () => {
    expect(buildSetCookie(SESSION_COOKIE, "abc", 2592000, true)).toContain("Max-Age=2592000");
  });

  it("値をURLエンコードする", () => {
    expect(buildSetCookie("n", "a b;c", 1, true)).toContain(`n=${encodeURIComponent("a b;c")}`);
  });
});

describe("readCookie", () => {
  function req(cookie?: string): Request {
    return new Request("https://example.com/", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("目的の Cookie を取り出す", () => {
    expect(readCookie(req("a=1; lp_session=xyz; b=2"), "lp_session")).toBe("xyz");
  });

  it("URLエンコードを戻す", () => {
    expect(readCookie(req(`lp_session=${encodeURIComponent("a b")}`), "lp_session")).toBe("a b");
  });

  it("無ければ null", () => {
    expect(readCookie(req("a=1"), "lp_session")).toBeNull();
    expect(readCookie(req(), "lp_session")).toBeNull();
  });

  it("名前の前方一致で誤検出しない", () => {
    expect(readCookie(req("lp_session_x=wrong"), "lp_session")).toBeNull();
  });
});
