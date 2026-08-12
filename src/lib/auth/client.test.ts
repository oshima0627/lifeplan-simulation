import { describe, expect, it, vi } from "vitest";
import {
  fetchMe,
  fetchResetTokenEmail,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup,
} from "./client";
import { deriveClientKey } from "./kdf";

// PBKDF2 が60万回回るので、signup/login/resetPassword を呼ぶテストは
// 1回あたり0.2〜0.6秒かかる（src/lib/auth/kdf.test.ts と同じ事情）。
// 既定の5秒タイムアウトを超えないよう、複数回呼ぶテストにだけ余裕を持たせる。
const SLOW = 20_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

describe("signup", () => {
  it("パスワード本体を送らず、43文字の鍵を送る", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    await signup(
      { email: "foo@example.com", password: "correct horse battery", turnstileToken: "tok" },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/signup");
    const body = parseBody(init);
    expect(body.password).toBeUndefined();
    expect(body.key).toHaveLength(43);
    expect(body.kdfVersion).toBe(1);
    expect(body.email).toBe("foo@example.com");
    expect(body.turnstileToken).toBe("tok");
  });

  it("credentials: same-origin を指定する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    await signup({ email: "foo@example.com", password: "pw", turnstileToken: "tok" }, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("same-origin");
  });

  it(
    "メールの大文字小文字が違っても同じ鍵を送る",
    async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
      await signup({ email: "Foo@Example.COM", password: "pw", turnstileToken: "tok" }, fetchImpl);
      await signup({ email: "foo@example.com", password: "pw", turnstileToken: "tok" }, fetchImpl);

      const key1 = parseBody(fetchImpl.mock.calls[0]?.[1] as RequestInit).key;
      const key2 = parseBody(fetchImpl.mock.calls[1]?.[1] as RequestInit).key;
      expect(key1).toBe(key2);
    },
    SLOW,
  );

  it("成功時は { ok: true } を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    const result = await signup(
      { email: "foo@example.com", password: "pw", turnstileToken: "tok" },
      fetchImpl,
    );
    expect(result).toEqual({ ok: true });
  });

  it.each([
    [409, "EMAIL_TAKEN", "このメールアドレスはすでに登録されています。ログインをお試しください。"],
    [403, "TURNSTILE_FAILED", "確認に失敗しました。ページを再読み込みしてからもう一度お試しください"],
    [429, "RATE_LIMITED", "しばらく時間をおいてから再度お試しください"],
  ])(
    "%i 応答をサーバーの文言のまま { ok: false, code, message } へ変換する",
    async (status, code, message) => {
      const fetchImpl = vi.fn().mockResolvedValue(errorResponse(code, message, status));
      const result = await signup(
        { email: "foo@example.com", password: "pw", turnstileToken: "tok" },
        fetchImpl,
      );
      expect(result).toEqual({ ok: false, code, message });
    },
  );

  it("ネットワークエラーで例外を投げず { ok: false } を返す", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await signup(
      { email: "foo@example.com", password: "pw", turnstileToken: "tok" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
  });
});

describe("login", () => {
  it("パスワード本体を送らず、43文字の鍵を送る（turnstileTokenは含めない）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    await login({ email: "foo@example.com", password: "correct horse battery" }, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/login");
    const body = parseBody(init);
    expect(body.password).toBeUndefined();
    expect(body.key).toHaveLength(43);
    expect(body.kdfVersion).toBe(1);
    expect(body).not.toHaveProperty("turnstileToken");
  });

  it("credentials: same-origin を指定する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    await login({ email: "foo@example.com", password: "pw" }, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("same-origin");
  });

  it("成功時は { ok: true } を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "u1" }));
    const result = await login({ email: "foo@example.com", password: "pw" }, fetchImpl);
    expect(result).toEqual({ ok: true });
  });

  it("401 AUTH_FAILED をサーバーの文言のまま返す（ユーザー不在と鍵違いを区別しない文言）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errorResponse("AUTH_FAILED", "メールアドレスまたはパスワードが違います", 401));
    const result = await login({ email: "foo@example.com", password: "pw" }, fetchImpl);
    expect(result).toEqual({
      ok: false,
      code: "AUTH_FAILED",
      message: "メールアドレスまたはパスワードが違います",
    });
  });

  it("429 RATE_LIMITED をサーバーの文言のまま返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errorResponse("RATE_LIMITED", "しばらく時間をおいてから再度お試しください", 429));
    const result = await login({ email: "foo@example.com", password: "pw" }, fetchImpl);
    expect(result).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "しばらく時間をおいてから再度お試しください",
    });
  });

  it("ネットワークエラーで例外を投げず { ok: false } を返す", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await login({ email: "foo@example.com", password: "pw" }, fetchImpl);
    expect(result.ok).toBe(false);
  });
});

describe("logout", () => {
  it("POST /api/auth/logout を same-origin で呼ぶ", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await logout(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("ネットワークエラーでも例外を投げない", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(logout(fetchImpl)).resolves.toBeUndefined();
  });
});

describe("fetchMe", () => {
  it("{ userId: null } のとき null を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: null }));
    const result = await fetchMe(fetchImpl);
    expect(result).toBeNull();
  });

  it("{ userId: 'user-1' } のとき文字列を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: "user-1" }));
    const result = await fetchMe(fetchImpl);
    expect(result).toBe("user-1");
  });

  it("GET を same-origin で呼ぶ", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ userId: null }));
    await fetchMe(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("ネットワークエラーで null を返す（例外を投げない）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchMe(fetchImpl);
    expect(result).toBeNull();
  });
});

describe("requestPasswordReset", () => {
  it("email だけを送る（常に成功として扱うのでボディの解釈はしない）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await requestPasswordReset("foo@example.com", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/forgot-password");
    expect(parseBody(init)).toEqual({ email: "foo@example.com" });
    expect(init.credentials).toBe("same-origin");
  });

  it("ネットワークエラーでも例外を投げない", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(requestPasswordReset("foo@example.com", fetchImpl)).resolves.toBeUndefined();
  });
});

describe("fetchResetTokenEmail", () => {
  it("有効なトークンでメールアドレスを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ email: "foo@example.com" }));
    const result = await fetchResetTokenEmail("tok-1", fetchImpl);
    expect(result).toBe("foo@example.com");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/reset-token?token=tok-1");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  it("無効・期限切れ・使用済みトークン（400）では null を返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errorResponse("RESET_TOKEN_INVALID", "このリンクは無効です", 400));
    const result = await fetchResetTokenEmail("bad-token", fetchImpl);
    expect(result).toBeNull();
  });

  it("トークンをURLエンコードする", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ email: "foo@example.com" }));
    await fetchResetTokenEmail("a b+c", fetchImpl);

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`/api/auth/reset-token?token=${encodeURIComponent("a b+c")}`);
  });

  it("ネットワークエラーで null を返す（例外を投げない）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchResetTokenEmail("tok-1", fetchImpl);
    expect(result).toBeNull();
  });
});

describe("resetPassword", () => {
  it(
    "送信ボディに email を含めず、token と43文字の鍵だけを送る",
    async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      await resetPassword(
        { token: "tok-1", email: "foo@example.com", password: "new password" },
        fetchImpl,
      );

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/auth/reset-password");
      const body = parseBody(init);
      expect(body).not.toHaveProperty("email");
      expect(body).not.toHaveProperty("password");
      expect(body.token).toBe("tok-1");
      expect(body.key).toHaveLength(43);
      expect(body.kdfVersion).toBe(1);
      expect(init.credentials).toBe("same-origin");
    },
    SLOW,
  );

  it(
    "deriveClientKey(email, password) と同じ鍵を送る",
    async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      await resetPassword(
        { token: "tok-1", email: "foo@example.com", password: "new password" },
        fetchImpl,
      );
      const expectedKey = await deriveClientKey("foo@example.com", "new password");

      const body = parseBody(fetchImpl.mock.calls[0]?.[1] as RequestInit);
      expect(body.key).toBe(expectedKey);
    },
    SLOW,
  );

  it(
    "400 RESET_TOKEN_INVALID をサーバーの文言のまま返す",
    async () => {
      const message = "このリンクは無効か、有効期限が切れています。再度パスワード再設定をお試しください";
      const fetchImpl = vi.fn().mockResolvedValue(errorResponse("RESET_TOKEN_INVALID", message, 400));
      const result = await resetPassword(
        { token: "bad", email: "foo@example.com", password: "new password" },
        fetchImpl,
      );
      expect(result).toEqual({ ok: false, code: "RESET_TOKEN_INVALID", message });
    },
    SLOW,
  );

  it(
    "ネットワークエラーで例外を投げず { ok: false } を返す",
    async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
      const result = await resetPassword(
        { token: "tok-1", email: "foo@example.com", password: "pw" },
        fetchImpl,
      );
      expect(result.ok).toBe(false);
    },
    SLOW,
  );
});
