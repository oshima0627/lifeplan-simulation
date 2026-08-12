// 課金まわりの D1 アクセス層。認証側の worker/db.ts と同じ方針で、
// SQL はここに集約し、呼び出し側では組み立てない。
//
// ⚠️ この層の要点は2つだけで、どちらも「複数文に分けた瞬間に壊れる」。
//   1. 利用回数の加算は、上限判定と加算を **単一SQL文** に畳む
//   2. 契約状態の更新は、順序ガードを **単一SQL文** に畳む
// SELECT してから UPDATE すると、同時リクエストで上限を超え、
// 順序が入れ替わった Webhook で解約済みが契約中に戻る。

export interface SubscriptionRow {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastEventCreated: number;
}

interface RawSubscriptionRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  last_event_created: number;
}

function toSubscription(row: RawSubscriptionRow): SubscriptionRow {
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    // SQLite に真偽値型は無く 0/1 で入る。ここで境界を吸収し、
    // 呼び出し側に 0/1 を漏らさない（`if (row.cancelAtPeriodEnd)` が
    // 文字列 "0" で真になるような事故を上流で防ぐ）
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    lastEventCreated: row.last_event_created,
  };
}

const SUBSCRIPTION_COLUMNS =
  "user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, last_event_created";

/** ユーザーIDで契約を引く。未契約なら null。 */
export async function findSubscriptionByUser(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  const row = await db
    .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ?`)
    .bind(userId)
    .first<RawSubscriptionRow>();
  return row ? toSubscription(row) : null;
}

/**
 * Stripe の customer ID からユーザーIDを引く。
 *
 * `customer.subscription.*` イベントには `client_reference_id` が無く、
 * 「誰の契約か」を customer ID からしか辿れないため必要。
 */
export async function findUserIdByCustomer(
  db: D1Database,
  stripeCustomerId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?")
    .bind(stripeCustomerId)
    .first<{ user_id: string }>();
  return row ? row.user_id : null;
}

/**
 * 契約状態をミラーする。実際に書き換えた時だけ `true` を返す。
 *
 * ⚠️ **Stripe の Webhook は順序を保証しない。** 解約（subscription.deleted）が
 * 契約（subscription.created）より先に届くことが実際に起きる。素直に上書きすると
 * 解約済みの人が契約中に戻り、課金していない人に有料機能が開く。
 *
 * `WHERE excluded.last_event_created >= subscriptions.last_event_created` で
 * 古いイベントを捨てる。この判定を JS 側（読んでから書く）に出すと、
 * Webhook が同時に2本届いた時にすり抜ける。
 *
 * `>` ではなく `>=` なのは、Stripe の `event.created` が**秒**精度で、
 * 同一秒のイベントが普通にあるため。`>` にすると正当な更新を落とす。
 */
export async function upsertSubscription(
  db: D1Database,
  input: SubscriptionRow,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         last_event_created = excluded.last_event_created,
         updated_at = excluded.updated_at
       WHERE excluded.last_event_created >= subscriptions.last_event_created`,
    )
    .bind(
      input.userId,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.status,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      input.lastEventCreated,
      new Date().toISOString(),
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * Webhook イベントを受領済みとして記録する。**初回だけ** `true` を返す。
 *
 * Stripe は同じイベントを再送する（こちらが 500 を返した時、タイムアウトした時、
 * そして理由なく重複することもある）。`INSERT OR IGNORE` の `changes` で
 * 判定するのは worker/db.ts の `createUser` と同じ作法。単一SQL文なので
 * 同時に2本届いても片方しか通らない。
 */
export async function markStripeEventSeen(
  db: D1Database,
  eventId: string,
): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)")
    .bind(eventId, new Date().toISOString())
    .run();
  return result.meta.changes > 0;
}

/** 指定期間（UTC の 'YYYY-MM'）の利用回数。未使用なら 0。 */
export async function getUsage(
  db: D1Database,
  userId: string,
  period: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT used FROM ai_usage WHERE user_id = ? AND period = ?")
    .bind(userId, period)
    .first<{ used: number }>();
  return row ? row.used : 0;
}

/**
 * 上限に達していなければ利用回数を1つ進める。進められた時だけ `true` を返す。
 *
 * ⚠️ 上限判定と加算を**単一SQL文**に畳んでいる。`getUsage` してから
 * `bumpUsage` すると、同時リクエストが両方とも「まだ余裕がある」を見て
 * 上限を超える。AI 呼び出しは1回ごとに実費が出るので、ここが破れると
 * そのまま原価になる。
 */
export async function bumpUsage(
  db: D1Database,
  userId: string,
  period: string,
  limit: number,
): Promise<boolean> {
  // 上限0以下は SQL に渡さず弾く。行が無い場合の INSERT は
  // ON CONFLICT を通らないため WHERE 句が効かず、1回目だけ通ってしまう
  if (limit <= 0) return false;

  const result = await db
    .prepare(
      `INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 1)
       ON CONFLICT(user_id, period) DO UPDATE SET used = used + 1
       WHERE used < ?`,
    )
    .bind(userId, period, limit)
    .run();
  return result.meta.changes > 0;
}

/** UTC の 'YYYY-MM'。利用回数の期間キー。 */
export function periodOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}
