import { currentUserId } from "../auth/current";
import { checkIpRateLimit } from "../auth/routes";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import { findSubscriptionByUser } from "./db";
import { resolveEntitlement } from "./entitlement";
import { getStripe } from "./stripe";

/**
 * Stripe API を叩くエンドポイントの1日あたりの上限（IPごと）。
 *
 * Checkout / Portal のセッション作成は外部 API を呼ぶので、無制限だと
 * Stripe 側のレート制限と Durable Object の書き込み枠を同時に食う。
 * 正規の利用者が1日に何度も契約し直すことはないため、低めで足りる。
 */
const BILLING_SESSION_DAILY_LIMIT = 20;

/** 契約状態と今月の残り回数。画面はこれだけを見る。 */
async function handleStatus(request: Request, env: AppEnv): Promise<Response> {
  const userId = await currentUserId(request, env);
  if (!userId) return errorResponse("UNAUTHORIZED", "ログインしてください", 401);

  const entitlement = await resolveEntitlement(env.DB, userId, new Date());
  return json(entitlement);
}

/**
 * Checkout セッションを作る。
 *
 * ⚠️ 金額をここに書かない。Stripe の Price ID を渡すことで、
 * 値上げ・値下げが Stripe 側の操作だけで完結し、コードと実際の請求額が
 * 食い違う状態を作らない。
 */
async function handleCheckout(request: Request, env: AppEnv): Promise<Response> {
  const userId = await currentUserId(request, env);
  if (!userId) return errorResponse("UNAUTHORIZED", "ログインしてください", 401);

  const allowed = await checkIpRateLimit(
    env,
    request.headers.get("cf-connecting-ip"),
    "billing",
    BILLING_SESSION_DAILY_LIMIT,
  );
  if (!allowed) {
    return errorResponse("RATE_LIMITED", "時間をおいてからお試しください", 429);
  }

  // すでに契約中なら Checkout ではなくポータルへ送る。
  // 二重契約は二重請求になり、返金という実作業が発生する
  const existing = await findSubscriptionByUser(env.DB, userId);
  if (existing && (existing.status === "active" || existing.status === "trialing")) {
    return errorResponse("ALREADY_SUBSCRIBED", "すでにご契約中です", 409);
  }

  const session = await getStripe(env).checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    // Webhook で「誰の契約か」を復元する唯一の手掛かり。metadata ではなく
    // これを使うのは、Checkout が必ず載せてくれる標準の項目だから
    client_reference_id: userId,
    // 2回目以降（解約後の再契約など）は既存の顧客に紐付ける。
    // 顧客が増殖すると、ポータルから過去の請求が見えなくなる
    ...(existing ? { customer: existing.stripeCustomerId } : {}),
    // ⚠️ env.APP_URL を使う。request.url から組み立てない。
    // Workers には http:// のリクエストもそのまま届くため、攻撃者が
    // 送ったスキームやポートが戻り先に混入する（worker/env.ts の警告参照）
    success_url: `${env.APP_URL}/account?checkout=success`,
    cancel_url: `${env.APP_URL}/account?checkout=cancel`,
  });

  if (!session.url) {
    return errorResponse("STRIPE_ERROR", "決済ページを開けませんでした", 502);
  }
  return json({ url: session.url });
}

/** 解約・カード変更のためのカスタマーポータル。解約手段を自前で作らない。 */
async function handlePortal(request: Request, env: AppEnv): Promise<Response> {
  const userId = await currentUserId(request, env);
  if (!userId) return errorResponse("UNAUTHORIZED", "ログインしてください", 401);

  const allowed = await checkIpRateLimit(
    env,
    request.headers.get("cf-connecting-ip"),
    "billing",
    BILLING_SESSION_DAILY_LIMIT,
  );
  if (!allowed) {
    return errorResponse("RATE_LIMITED", "時間をおいてからお試しください", 429);
  }

  const existing = await findSubscriptionByUser(env.DB, userId);
  if (!existing) {
    return errorResponse("NOT_SUBSCRIBED", "ご契約が見つかりません", 404);
  }

  const session = await getStripe(env).billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${env.APP_URL}/account`,
  });
  return json({ url: session.url });
}

const ROUTES: Record<string, (request: Request, env: AppEnv) => Promise<Response>> = {
  "GET /api/billing/status": handleStatus,
  "POST /api/billing/checkout": handleCheckout,
  "POST /api/billing/portal": handlePortal,
};

const KNOWN_PATHS = new Set(Object.keys(ROUTES).map((key) => key.split(" ", 2)[1]));

/** `/api/billing/*` のディスパッチ。作法は handleAuthRoute と揃える。 */
export async function handleBillingRoute(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response | null> {
  const handler = ROUTES[`${request.method} ${url.pathname}`];
  if (handler) return handler(request, env);
  if (KNOWN_PATHS.has(url.pathname)) {
    return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
  }
  return null;
}
