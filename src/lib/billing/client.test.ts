import { describe, expect, it, vi } from "vitest";
import { fetchBillingStatus, openPortal, startCheckout } from "./client";

// 型引数で引数の形を与える。実装側に引数を書くと未使用として lint に出るし、
// 省くと mock.calls が空タプル型になって init を取り出せない
function fakeFetch(status: number, body: unknown) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("課金クライアント", () => {
  // 付け忘れるとセッション Cookie が送られず、全て 401 になる
  it("すべての呼び出しに credentials: same-origin を付ける", async () => {
    const f = fakeFetch(200, { paid: false });
    await fetchBillingStatus(f as unknown as typeof fetch);
    await startCheckout(f as unknown as typeof fetch);
    await openPortal(f as unknown as typeof fetch);
    for (const call of f.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe("same-origin");
    }
  });

  it("status は GET、checkout と portal は POST", async () => {
    const f = fakeFetch(200, {});
    await fetchBillingStatus(f as unknown as typeof fetch);
    await startCheckout(f as unknown as typeof fetch);
    await openPortal(f as unknown as typeof fetch);
    const methods = f.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["GET", "POST", "POST"]);
  });

  it("成功時は本文をそのまま返す", async () => {
    const body = {
      paid: true,
      limit: 100,
      used: 3,
      remaining: 97,
      currentPeriodEnd: "2026-09-13T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    };
    const result = await fetchBillingStatus(fakeFetch(200, body) as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, value: body });
  });

  // 言い換えると「すでにご契約中です」のような分岐ごとの案内が崩れる
  it("サーバーのエラー文言をそのまま返す", async () => {
    const f = fakeFetch(409, {
      error: { code: "ALREADY_SUBSCRIBED", message: "すでにご契約中です" },
    });
    const result = await startCheckout(f as unknown as typeof fetch);
    expect(result).toEqual({
      ok: false,
      code: "ALREADY_SUBSCRIBED",
      message: "すでにご契約中です",
    });
  });

  // 画面を落とすより、エラー表示のほうが良い
  it("通信自体が失敗しても例外を投げない", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await fetchBillingStatus(f as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NETWORK_ERROR");
  });

  it("本文が JSON でなくても例外を投げない", async () => {
    const f = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    const result = await openPortal(f as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_ERROR");
  });
});
