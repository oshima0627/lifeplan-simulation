import Stripe from "stripe";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import { findUserIdByCustomer, markStripeEventSeen, upsertSubscription } from "./db";
import { getStripe } from "./stripe";

/**
 * Stripe Webhook。契約状態を D1 にミラーする唯一の入口。
 *
 * ⚠️ **署名検証を省くと、リクエスト偽造で誰でも自分を「契約中」にできる。**
 *
 * 処理順を変えないこと:
 *   1. パスが違えば null（他のルータに渡す）
 *   2. 署名の検証（ここを通らないものは一切 DB に触らせない）
 *   3. 冪等性（再送は即 200。DB を触らない）
 *   4. ミラー（順序ガードは db.ts の SQL 側）
 *
 * ⚠️ 認証（Cookie）を要求しない。Stripe はこちらのセッションを持たない。
 * そのため worker/index.ts では **handleAuthRoute より前** に呼ぶ。
 */
export async function handleStripeWebhook(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== "/api/stripe/webhook") return null;
  if (request.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    return errorResponse("SIGNATURE_MISSING", "署名がありません", 400);
  }

  // ⚠️ `request.text()` を使わない。Workers の UTF-8 デコードを経由すると、
  // 日本語などマルチバイトを含むイベントでバイト列がズレて署名が一致しない。
  // 生バイトのまま渡し、デコードは Stripe SDK に任せる。
  const raw = new Uint8Array(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    // ⚠️ 同期版 `constructEvent` は Node の crypto に依存し Workers では動かない。
    // SubtleCrypto を使う非同期版でなければならない。
    event = await getStripe(env).webhooks.constructEventAsync(
      raw,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    // 失敗の理由（許容時間超過か鍵違いか）は返さない。総当たりの手掛かりになる
    return errorResponse("SIGNATURE_INVALID", "署名が不正です", 400);
  }

  try {
    // Stripe は同じイベントを再送する（500 を返した時、タイムアウトした時、
    // そして理由なく重複することもある）。2回目以降は何もせず 200 を返す
    if (!(await markStripeEventSeen(env.DB, event.id))) {
      return json({ received: true, duplicate: true });
    }

    await applyEvent(event, env);
    return json({ received: true });
  } catch (err) {
    // DB 書き込みの失敗は 500 で返して Stripe に再送させる。
    // 処理は冪等（stripe_events + 順序ガード）なので再送は安全。
    //
    // ⚠️ ここで 200 を返すと Stripe は再送しない。ミラーが欠けたまま
    // 「課金しているのに使えない」状態が永久に残る。
    console.error("[stripe/webhook] 処理失敗:", err);
    return errorResponse("INTERNAL_ERROR", "サーバーエラーが発生しました", 500);
  }
}

/** イベント種別ごとのミラー。扱わない種別は黙って無視する（200 を返す）。 */
async function applyEvent(event: Stripe.Event, env: AppEnv): Promise<void> {
  if (event.type === "checkout.session.completed") {
    await applyCheckoutCompleted(event, env);
    return;
  }
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await applySubscriptionChange(event.data.object, event.created, env);
  }
}

/**
 * 契約の成立。**userId と Stripe customer を結び付ける唯一の機会。**
 *
 * `customer.subscription.*` には userId を運ぶ場所が無く、customer ID から
 * 逆引きするしかない。その対応表をここで作る。
 */
async function applyCheckoutCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
  env: AppEnv,
): Promise<void> {
  const session = event.data.object;
  const userId = session.client_reference_id;
  const customerId = toId(session.customer);
  // サブスク以外の Checkout はこのサービスに無いが、将来足した時に
  // 契約状態を壊さないよう種別で絞る
  if (!userId || !customerId || session.mode !== "subscription") return;

  await upsertSubscription(env.DB, {
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: toId(session.subscription),
    // Checkout 完了時点では契約は有効。正確な status と期末は
    // 直後に届く customer.subscription.created が上書きする
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastEventCreated: event.created,
  });
}

/** 契約状態の変化（作成・更新・解約）をミラーする。 */
async function applySubscriptionChange(
  subscription: Stripe.Subscription,
  eventCreated: number,
  env: AppEnv,
): Promise<void> {
  const customerId = toId(subscription.customer);
  if (!customerId) return;

  // checkout.session.completed が先に対応表を作っている前提。
  // 見つからない場合（順序が入れ替わった等）は何もしない。
  // ここで新規行を作ると user_id が分からず、誰のものでもない契約が残る。
  // Stripe はこの後 checkout.session.completed を再送しないため、
  // 取りこぼしたら手動で紐付ける（運用ログに残す）
  const userId = await findUserIdByCustomer(env.DB, customerId);
  if (!userId) {
    console.error("[stripe/webhook] 未知の customer:", customerId);
    return;
  }

  await upsertSubscription(env.DB, {
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: periodEndIso(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    lastEventCreated: eventCreated,
  });
}

/**
 * 契約の期末を ISO で返す。
 *
 * ⚠️ **`subscription.current_period_end` は存在しない。** Stripe の
 * API 2025-03-31 以降、期間は subscription **item** 側に移った
 * （SDK 22 / `2026-07-29.dahlia` で確認済み）。古い記憶のまま
 * `subscription.current_period_end` と書くと、型検査は通っても
 * 常に undefined になり、期末が永久に null のままになる。
 *
 * このサービスは price を1つしか売らないので item も1つだが、
 * 将来増えた時に「一番早く切れる方」を返すのが安全側になるため最小値を採る。
 */
function periodEndIso(subscription: Stripe.Subscription): string | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((end): end is number => typeof end === "number");
  if (ends.length === 0) return null;
  // Stripe の時刻は Unix 秒。ミリ秒と取り違えると 1970 年になる
  return new Date(Math.min(...ends) * 1000).toISOString();
}

/**
 * Stripe の「ID または展開済みオブジェクト」を ID に潰す。
 *
 * Webhook の payload は基本的に文字列 ID で来るが、Stripe 側の設定や
 * API 版によって展開されて来ることがある。どちらでも壊れないようにする。
 */
function toId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.id === "string") return value.id;
  return null;
}
