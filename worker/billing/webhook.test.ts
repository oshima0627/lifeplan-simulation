import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../env";

// Stripe クライアントは差し替える。ここで検証したいのは
// 「署名を通らないものを DB に触らせないか」「再送で二重に処理しないか」
// 「順序が入れ替わっても状態が戻らないか」であって、Stripe SDK の暗号処理ではない。
const constructEventAsync = vi.fn();
// 署名検証の失敗は vi.fn() の中で投げず、この素の包み側で投げる。
// vi.fn() が投げた例外は、呼び出し側（handleStripeWebhook）が正しく捕捉して
// 400 を返していても、vitest が未処理エラーとして拾いテストを落とすため
let signatureVerificationFails = false;
vi.mock("./stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEventAsync: async (...args: unknown[]) => {
        if (signatureVerificationFails) throw new Error("no match");
        return constructEventAsync(...args);
      },
    },
  }),
}));

const { handleStripeWebhook } = await import("./webhook");

// subscriptions / stripe_events / ai_usage の最小スタブ。
// upsert の順序ガードは実物の SQLite で検証済み（計画のTask3）なので、
// ここでは SQL に正しい引数が渡ることと、呼ばれない場合に呼ばれないことを見る。
class FakeD1 {
  events = new Set<string>();
  subscriptions = new Map<string, Record<string, unknown>>();
  customerToUser = new Map<string, string>();
  upsertCalls: unknown[][] = [];

  prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        if (sql.startsWith("INSERT OR IGNORE INTO stripe_events")) {
          const id = args[0] as string;
          if (this.events.has(id)) return { meta: { changes: 0 } };
          this.events.add(id);
          return { meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO subscriptions")) {
          this.upsertCalls.push(args);
          const [userId, customerId] = args as [string, string];
          const prev = this.subscriptions.get(userId);
          const incoming = args[6] as number;
          // 実物の SQLite で確認した順序ガードをここでも同じに再現する
          if (prev && (prev.lastEventCreated as number) > incoming) {
            return { meta: { changes: 0 } };
          }
          this.subscriptions.set(userId, {
            status: args[3],
            currentPeriodEnd: args[4],
            lastEventCreated: incoming,
          });
          this.customerToUser.set(customerId, userId);
          return { meta: { changes: 1 } };
        }
        throw new Error(`想定外のSQL: ${sql}`);
      },
      first: async () => {
        if (sql.includes("SELECT user_id FROM subscriptions")) {
          const userId = this.customerToUser.get(args[0] as string);
          return userId ? { user_id: userId } : null;
        }
        throw new Error(`想定外のSQL: ${sql}`);
      },
    }),
  });
}

function makeEnv(db: FakeD1): AppEnv {
  return {
    DB: db as unknown as AppEnv["DB"],
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
  } as unknown as AppEnv;
}

function post(body = "{}", headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    body,
    headers,
  });
}

const url = new URL("https://example.com/api/stripe/webhook");

function subscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated",
  overrides: { created: number; status: string; periodEnd?: number },
) {
  return {
    id: `evt_${type}_${overrides.created}`,
    type,
    created: overrides.created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: overrides.status,
        cancel_at_period_end: false,
        items: {
          data: [{ current_period_end: overrides.periodEnd ?? 1_800_000_000 }],
        },
      },
    },
  };
}

describe("handleStripeWebhook", () => {
  // 呼び出し履歴だけを消す。実装は各テストが自分で設定する
  beforeEach(() => {
    constructEventAsync.mockClear();
    signatureVerificationFails = false;
  });

  it("別パスは null を返して他のルータに渡す", async () => {
    const other = new URL("https://example.com/api/auth/me");
    expect(
      await handleStripeWebhook(new Request(other), makeEnv(new FakeD1()), other),
    ).toBeNull();
  });

  it("GET は 405", async () => {
    const res = await handleStripeWebhook(
      new Request(url, { method: "GET" }),
      makeEnv(new FakeD1()),
      url,
    );
    expect(res?.status).toBe(405);
  });

  // ここが破れると、偽造リクエストで誰でも自分を「契約中」にできる
  it("署名ヘッダが無ければ 400。DB に一切触らない", async () => {
    const db = new FakeD1();
    const res = await handleStripeWebhook(post(), makeEnv(db), url);
    expect(res?.status).toBe(400);
    expect(constructEventAsync).not.toHaveBeenCalled();
    expect(db.upsertCalls).toHaveLength(0);
  });

  it("署名検証に失敗したら 400。DB に触らない", async () => {
    const db = new FakeD1();
    signatureVerificationFails = true;
    const res = await handleStripeWebhook(
      post("{}", { "stripe-signature": "t=1,v1=x" }),
      makeEnv(db),
      url,
    );
    expect(res?.status).toBe(400);
    expect(db.upsertCalls).toHaveLength(0);
  });

  it("生バイト（Uint8Array）を検証に渡す。text() でデコードしない", async () => {
    const db = new FakeD1();
    constructEventAsync.mockResolvedValue({ id: "evt_1", type: "ping", created: 1, data: { object: {} } });
    // 日本語を含む本文。text() を経由すると署名対象のバイト列がズレる
    await handleStripeWebhook(post('{"m":"日本語"}', { "stripe-signature": "sig" }), makeEnv(db), url);
    expect(constructEventAsync.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  });

  it("同じイベントの再送では DB を書き換えない", async () => {
    const db = new FakeD1();
    const event = {
      id: "evt_dup",
      type: "checkout.session.completed",
      created: 100,
      data: {
        object: { mode: "subscription", client_reference_id: "u1", customer: "cus_1", subscription: "sub_1" },
      },
    };
    constructEventAsync.mockResolvedValue(event);

    const first = await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);
    const second = await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(db.upsertCalls).toHaveLength(1);
  });

  // Stripe の Webhook は順序を保証しない。
  // 解約が契約より先に届いても、契約中に戻ってはいけない
  it("古いイベントが後から届いても状態が戻らない", async () => {
    const db = new FakeD1();
    db.customerToUser.set("cus_1", "u1");

    constructEventAsync.mockResolvedValue(
      subscriptionEvent("customer.subscription.updated", { created: 200, status: "canceled" }),
    );
    await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);

    constructEventAsync.mockResolvedValue(
      subscriptionEvent("customer.subscription.created", { created: 100, status: "active" }),
    );
    await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);

    expect(db.subscriptions.get("u1")?.status).toBe("canceled");
  });

  // ⚠️ Stripe の API 2025-03-31 以降、current_period_end は
  // subscription ではなく item 側にある。ここが崩れると期末が永久に null になる
  it("期末を subscription item から取る", async () => {
    const db = new FakeD1();
    db.customerToUser.set("cus_1", "u1");
    constructEventAsync.mockResolvedValue(
      subscriptionEvent("customer.subscription.created", {
        created: 300,
        status: "active",
        periodEnd: 1_800_000_000,
      }),
    );
    await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);
    expect(db.subscriptions.get("u1")?.currentPeriodEnd).toBe(
      new Date(1_800_000_000 * 1000).toISOString(),
    );
  });

  it("未知の customer では行を作らない（誰のものでもない契約を残さない）", async () => {
    const db = new FakeD1();
    constructEventAsync.mockResolvedValue(
      subscriptionEvent("customer.subscription.created", { created: 300, status: "active" }),
    );
    const res = await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);
    expect(res?.status).toBe(200);
    expect(db.upsertCalls).toHaveLength(0);
  });

  // 200 を返すと Stripe は再送しない。ミラーが欠けたまま
  // 「課金しているのに使えない」が永久に残る
  it("DB 失敗は 500 で返して再送させる", async () => {
    const db = new FakeD1();
    db.customerToUser.set("cus_1", "u1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.prepare = () => {
      throw new Error("db down");
    };
    constructEventAsync.mockResolvedValue(
      subscriptionEvent("customer.subscription.created", { created: 300, status: "active" }),
    );
    const res = await handleStripeWebhook(post("{}", { "stripe-signature": "sig" }), makeEnv(db), url);
    expect(res?.status).toBe(500);
  });
});
