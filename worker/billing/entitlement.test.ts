import { describe, expect, it } from "vitest";
import type { SubscriptionRow } from "./db";
import { FREE_MONTHLY_LIMIT, PAID_MONTHLY_LIMIT, resolveEntitlement } from "./entitlement";

// 契約状態と利用回数だけを返す最小のスタブ。
// ここで固定したいのは「どの status を有料とみなすか」なので、
// SQL の中身ではなく判定の分岐を見る。
function makeDb(subscription: SubscriptionRow | null, used = 0) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes("FROM subscriptions")) {
            if (!subscription) return null;
            return {
              user_id: subscription.userId,
              stripe_customer_id: subscription.stripeCustomerId,
              stripe_subscription_id: subscription.stripeSubscriptionId,
              status: subscription.status,
              current_period_end: subscription.currentPeriodEnd,
              cancel_at_period_end: subscription.cancelAtPeriodEnd ? 1 : 0,
              last_event_created: subscription.lastEventCreated,
            };
          }
          if (sql.includes("FROM ai_usage")) return used > 0 ? { used } : null;
          throw new Error(`想定外のSQL: ${sql}`);
        },
      }),
    }),
  } as unknown as D1Database;
}

const base: SubscriptionRow = {
  userId: "u1",
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  status: "active",
  currentPeriodEnd: "2026-09-13T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  lastEventCreated: 100,
};

const NOW = new Date("2026-08-13T00:00:00.000Z");

describe("resolveEntitlement", () => {
  it("契約が無ければ無料枠（月1回）", async () => {
    const e = await resolveEntitlement(makeDb(null), "u1", NOW);
    expect(e.paid).toBe(false);
    expect(e.limit).toBe(FREE_MONTHLY_LIMIT);
    expect(e.remaining).toBe(1);
  });

  it("active なら有料枠（月100回）", async () => {
    const e = await resolveEntitlement(makeDb(base), "u1", NOW);
    expect(e.paid).toBe(true);
    expect(e.limit).toBe(PAID_MONTHLY_LIMIT);
  });

  it("trialing も有料枠", async () => {
    const e = await resolveEntitlement(makeDb({ ...base, status: "trialing" }), "u1", NOW);
    expect(e.paid).toBe(true);
  });

  // 決済が通っていない以上、有料枠は開けない。
  // ただし締め出しはせず無料枠には落とす
  it("past_due は無料枠に落ちる", async () => {
    const e = await resolveEntitlement(makeDb({ ...base, status: "past_due" }), "u1", NOW);
    expect(e.paid).toBe(false);
    expect(e.limit).toBe(FREE_MONTHLY_LIMIT);
  });

  it("incomplete は無料枠に落ちる", async () => {
    const e = await resolveEntitlement(makeDb({ ...base, status: "incomplete" }), "u1", NOW);
    expect(e.paid).toBe(false);
  });

  // Stripe は解約予約中も期末までは active を保つため、
  // canceled が届いた時点で本当に利用権が無い。
  // 期末が未来でも有料枠に戻さない
  it("canceled は期末が未来でも無料枠", async () => {
    const e = await resolveEntitlement(
      makeDb({ ...base, status: "canceled", currentPeriodEnd: "2099-01-01T00:00:00.000Z" }),
      "u1",
      NOW,
    );
    expect(e.paid).toBe(false);
    expect(e.limit).toBe(FREE_MONTHLY_LIMIT);
  });

  it("使い切っても remaining が負にならない", async () => {
    const e = await resolveEntitlement(makeDb(null, 5), "u1", NOW);
    expect(e.used).toBe(5);
    expect(e.remaining).toBe(0);
  });

  it("解約予約は契約中でもそのまま伝える（画面で案内するため）", async () => {
    const e = await resolveEntitlement(makeDb({ ...base, cancelAtPeriodEnd: true }), "u1", NOW);
    expect(e.paid).toBe(true);
    expect(e.cancelAtPeriodEnd).toBe(true);
    expect(e.currentPeriodEnd).toBe("2026-09-13T00:00:00.000Z");
  });
});
