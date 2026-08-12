import { describe, expect, it, vi } from "vitest";
import { sendPasswordResetMail } from "./email";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseInput = {
  to: "user@example.com",
  token: "abc def+ghi", // URLエンコード対象の文字（スペース・+）を含む
  expiresInMinutes: 30,
  apiKey: "re_test_key",
  from: "noreply@example.com",
  appUrl: "https://lifeplan.example.com",
};

describe("sendPasswordResetMail", () => {
  it("正しいエンドポイントへPOSTする", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
  });

  it("Authorization ヘッダーに apiKey が入る", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer re_test_key");
  });

  it("from が指定どおり使われる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("noreply@example.com");
    expect(body.to).toBe("user@example.com");
  });

  it("本文に appUrl + /reset-password?token=... のリンクが入り、トークンがURLエンコードされている", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const expectedLink = `https://lifeplan.example.com/reset-password?token=${encodeURIComponent("abc def+ghi")}`;
    expect(body.text).toContain(expectedLink);
    // エンコードされていない生トークンがそのまま入っていないこと
    expect(body.text).not.toContain("reset-password?token=abc def+ghi");
  });

  it("appUrl に末尾スラッシュが付いていても // にならない", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({
      ...baseInput,
      appUrl: "https://example.com/",
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const expectedLink = `https://example.com/reset-password?token=${encodeURIComponent(baseInput.token)}`;
    expect(body.text).toContain(expectedLink);
    expect(body.text).not.toContain("//reset-password");
  });

  it("件名にサービス名（ライフプランシミュレーター）が含まれる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.subject).toContain("ライフプランシミュレーター");
  });

  it("本文に有効期限（分）が入る", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("30");
  });

  it("本文に「再設定すると全端末からログアウトされる」旨の一文が入る", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("再設定すると、ログイン中のすべての端末からログアウトされます。");
  });

  it("HTMLを送らずテキストのみで送信する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    await sendPasswordResetMail({ ...baseInput, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("html");
    expect(typeof body.text).toBe("string");
  });

  it("失敗（HTTPステータス異常）時に例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "bad request" }, 422));
    await expect(sendPasswordResetMail({ ...baseInput, fetchImpl })).rejects.toThrow();
  });

  it("失敗時の例外メッセージに宛先メールアドレスが含まれない", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ message: `invalid recipient: ${baseInput.to}` }, 422),
    );

    try {
      await sendPasswordResetMail({ ...baseInput, fetchImpl });
      expect.unreachable("例外が投げられるはず");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(baseInput.to);
      expect(message).toContain("422");
    }
  });

  it("fetchImpl を省略した場合はグローバル fetch が使われる", async () => {
    const globalFetch = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    vi.stubGlobal("fetch", globalFetch);
    try {
      await sendPasswordResetMail(baseInput);
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
