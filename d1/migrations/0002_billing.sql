-- 課金と利用回数（設計書 §9 / 計画 docs/superpowers/plans/2026-08-13-subprojectB-stripe-subscription.md）。
--
-- 0001 と同じ方針で、ここに入るのは契約状態と回数だけ。
-- 年収・資産額・家族構成は D1 にも Stripe の metadata にも入れない。

-- Stripe の契約状態のミラー。利用可否の判定は常にこの表を読む。
-- 判定のたびに Stripe API を叩くと、Stripe が落ちた時に自社サービスも一緒に落ちるうえ、
-- 1リクエストごとに外部往復が増えて Workers の CPU 時間を食う。
CREATE TABLE subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id),
  stripe_customer_id     TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  -- Stripe の status をそのまま持つ（active / trialing / past_due / canceled 等）。
  -- 独自の語彙（"有効"/"無効"）に翻訳して保存すると、Stripe 側が状態を増やした時に
  -- 変換漏れが黙って誤判定になる。翻訳は読み出し側（entitlement.ts）で行う
  status                 TEXT NOT NULL,
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  -- ⚠️ Stripe の Webhook は順序を保証しない。解約イベントが契約イベントより先に
  -- 届くことが実際に起きる。素直に上書きすると、解約済みの人が契約中に戻る。
  -- event.created（秒）を持ち、これ以前のイベントでは更新しない
  last_event_created     INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL
);

-- Webhook は「誰の契約か」を customer ID からしか辿れないイベントがあるため
CREATE INDEX idx_subscriptions_customer ON subscriptions(stripe_customer_id);

-- 月次の利用回数。period は UTC の 'YYYY-MM'。
-- 期間をキーに含めることで、月初にリセットするバッチが要らなくなる
-- （Cron Trigger を1本減らせる＝止まっても気づけない仕組みを1つ減らせる）。
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  period  TEXT NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- Webhook の冪等性。Stripe は同じイベントを再送する（こちらが 500 を返した時、
-- タイムアウトした時、そして理由なく重複することもある）。
CREATE TABLE stripe_events (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
