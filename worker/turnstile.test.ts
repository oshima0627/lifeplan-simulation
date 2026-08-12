import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyTurnstile", () => {
  it("success: true の応答なら true を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(true);
  });

  it("success: false の応答なら false を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: false }));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("fetch が例外を投げたら false を返す（true にしない）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("HTTPステータスが200以外なら false を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }, 500));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("応答のJSONが壊れていたら false を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json{{{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("応答に success が無い場合は false を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ "error-codes": ["invalid-input-response"] }));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("応答の success がbooleanでない場合は false を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: "true" }));
    expect(await verifyTurnstile("token", "secret", undefined, fetchImpl)).toBe(false);
  });

  it("トークンが文字列でなければ fetch を呼ばずに false を返す", async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile(undefined, "secret", undefined, fetchImpl)).toBe(false);
    expect(await verifyTurnstile(null, "secret", undefined, fetchImpl)).toBe(false);
    expect(await verifyTurnstile(123, "secret", undefined, fetchImpl)).toBe(false);
    expect(await verifyTurnstile({ token: "x" }, "secret", undefined, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("送信ボディに secret と response が入っている", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    await verifyTurnstile("my-token", "my-secret", undefined, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.secret).toBe("my-secret");
    expect(body.response).toBe("my-token");
  });

  it("remoteIp を渡したときだけ remoteip が入る", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));

    await verifyTurnstile("token", "secret", "1.2.3.4", fetchImpl);
    const bodyWithIp = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(bodyWithIp.remoteip).toBe("1.2.3.4");

    fetchImpl.mockClear();
    await verifyTurnstile("token", "secret", undefined, fetchImpl);
    const bodyWithoutIp = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(bodyWithoutIp).not.toHaveProperty("remoteip");
  });

  it("エンドポイントURLへPOSTする", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    await verifyTurnstile("token", "secret", undefined, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
  });
});
