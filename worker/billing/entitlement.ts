// 「AI アドバイスを使ってよいか」の唯一の判定。
// AI 層（サブプロジェクト C）はここだけを呼び、契約状態や利用回数を自分で読まない。
// 判定が2箇所に散ると、片方だけ直した時に無料で使えてしまう。

import { findSubscriptionByUser, getUsage, periodOf } from "./db";

/** 契約者の月間上限（設計書の合意値）。 */
export const PAID_MONTHLY_LIMIT = 100;

/**
 * 未契約の登録者に開けるお試し回数（月1回）。
 *
 * ⚠️ 現状 signup はメール到達性を確認していない（Turnstile 通過だけで
 * アカウントが確定する）。**この枠を開ける前に signup へメール確認を入れる**
 * こと（設計書 §11.1）。入れないと、捨てアドレスを量産して無制限に使える。
 */
export const FREE_MONTHLY_LIMIT = 1;

/**
 * 「契約中」とみなす Stripe の status。
 *
 * `past_due`（決済失敗）と `incomplete`（初回決済が未完了）を含めない。
 * 支払われていない以上、有料枠を開けない。無料枠には落ちるので、
 * 締め出されるわけではない。
 *
 * `canceled` も含めない。Stripe は解約予約中も期末までは `active` を保つため、
 * `canceled` が届いた時点で本当に利用権が無い。
 */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

export interface Entitlement {
  /** 有料の契約が有効か。 */
  paid: boolean;
  /** 今月の上限回数。 */
  limit: number;
  /** 今月すでに使った回数。 */
  used: number;
  /** 残り回数（0未満にはならない）。 */
  remaining: number;
  /** 契約の現在の期末（ISO）。未契約なら null。 */
  currentPeriodEnd: string | null;
  /** 期末で解約される予約が入っているか。 */
  cancelAtPeriodEnd: boolean;
}

/**
 * 利用権を解決する。
 *
 * D1 のミラーだけを読み、Stripe API は叩かない（Stripe の障害を
 * そのまま自社サービスの障害にしないため。webhook.ts がミラーを保つ）。
 */
export async function resolveEntitlement(
  db: D1Database,
  userId: string,
  now: Date,
): Promise<Entitlement> {
  const subscription = await findSubscriptionByUser(db, userId);
  const paid = subscription !== null && ACTIVE_STATUSES.has(subscription.status);
  const limit = paid ? PAID_MONTHLY_LIMIT : FREE_MONTHLY_LIMIT;
  const used = await getUsage(db, userId, periodOf(now));
  return {
    paid,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    currentPeriodEnd: subscription ? subscription.currentPeriodEnd : null,
    cancelAtPeriodEnd: subscription ? subscription.cancelAtPeriodEnd : false,
  };
}
