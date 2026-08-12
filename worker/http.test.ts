import { describe, expect, it } from "vitest";
import { errorResponse, json } from "./http";

describe("json", () => {
  it("既定で 200 と application/json を返す", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("ステータスを指定できる", () => {
    expect(json({ ok: true }, 201).status).toBe(201);
  });

  it("キャッシュを禁止する", () => {
    // 認証状態を含む応答が中間キャッシュに残ると、別人に配られる
    expect(json({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });

  it("追加ヘッダを載せられる（例: login の Set-Cookie）", () => {
    const res = json({ ok: true }, 200, { "set-cookie": "session=abc; HttpOnly" });
    expect(res.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
  });

  it("呼び出し側が cache-control を渡しても BASE_HEADERS が勝つ", () => {
    // 呼び出し側の書き間違い（例: cache-control: public）でも上書きされない
    const res = json({ ok: true }, 200, { "cache-control": "public, max-age=3600" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("errorResponse", () => {
  it("コードとメッセージを本文に入れる", async () => {
    const res = errorResponse("INVALID_INPUT", "入力が不正です", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "入力が不正です" },
    });
  });

  it("キャッシュを禁止する", () => {
    expect(errorResponse("X", "y", 400).headers.get("cache-control")).toBe("no-store");
  });

  it("追加ヘッダを載せられる（例: レート制限の Retry-After）", () => {
    const res = errorResponse("RATE_LIMITED", "しばらく待ってください", 429, {
      "retry-after": "30",
    });
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("呼び出し側が cache-control を渡しても BASE_HEADERS が勝つ", () => {
    const res = errorResponse("X", "y", 400, { "cache-control": "public, max-age=3600" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
