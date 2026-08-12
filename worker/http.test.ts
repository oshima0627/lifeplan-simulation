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
});
