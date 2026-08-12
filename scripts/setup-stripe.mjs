// Stripe の商品・価格・Webhook エンドポイントをまとめて用意する。
//
// 使い方（PowerShell）:
//   $env:STRIPE_SECRET_KEY = "sk_test_..."   ← テストモードの鍵から始める
//   node scripts/setup-stripe.mjs
//
// ⚠️ 鍵はこのスクリプトが環境変数から読むだけで、どこにも保存しない。
// ⚠️ Webhook 署名シークレットは**画面に出さず**、そのまま
//    `wrangler secret put STRIPE_WEBHOOK_SECRET` の標準入力へ流し込む。
//    目に見える場所に出さないことで、貼り付け事故を防ぐ。
//
// 何度実行しても同じ状態になる（作成済みなら作らない）。

import { spawn } from "node:child_process";
import Stripe from "stripe";

const WEBHOOK_URL = "https://lifeplan.nexeed-lab.com/api/stripe/webhook";

// worker/billing/webhook.ts が実際に処理するイベントと一致させる。
// 余計なイベントを購読すると、無視するだけのリクエストで
// Durable Object の書き込み枠（stripe_events への INSERT）を食う。
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

// ⚠️ JPY は Stripe の「ゼロ十進通貨」。1,980円は 1980 であって 198000 ではない。
// ここを間違えると 100 倍の請求になる。
const PRICE_JPY = 1980;

// 作ったものを再実行時に見分けるための印。名前で探すと、
// 手で名前を変えた瞬間に二重作成される
const TAG = { app: "lifeplan", role: "ai_advisor_monthly" };

function tagged(metadata) {
  return metadata?.app === TAG.app && metadata?.role === TAG.role;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY が未設定です。環境変数に入れてから実行してください。");
    process.exit(1);
  }
  const stripe = new Stripe(key);
  const mode = key.startsWith("sk_live_") ? "本番" : "テスト";
  console.log(`Stripe（${mode}モード）に接続します。`);

  // --- 商品 ---
  const products = await stripe.products.list({ limit: 100, active: true });
  let product = products.data.find((p) => tagged(p.metadata));
  if (product) {
    console.log(`商品は作成済みです: ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: "ライフプラン AIアドバイス",
      description: "作成したライフプランシートをもとに、FPの視点で改善案を提示します。",
      metadata: TAG,
    });
    console.log(`商品を作成しました: ${product.id}`);
  }

  // --- 価格 ---
  const prices = await stripe.prices.list({ product: product.id, limit: 100, active: true });
  let price = prices.data.find(
    (p) =>
      p.currency === "jpy" &&
      p.unit_amount === PRICE_JPY &&
      p.recurring?.interval === "month" &&
      p.recurring?.interval_count === 1,
  );
  if (price) {
    console.log(`価格は作成済みです: ${price.id}`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      currency: "jpy",
      unit_amount: PRICE_JPY,
      recurring: { interval: "month" },
      metadata: TAG,
    });
    console.log(`価格を作成しました: ${price.id}`);
  }

  // --- Webhook ---
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = endpoints.data.find((e) => e.url === WEBHOOK_URL);
  if (existing) {
    // ⚠️ 署名シークレットは作成時にしか返らない。既にある場合は取り出せないので、
    // 「一度消して作り直す」以外に自動化する方法が無い。勝手に消すと
    // 本番の課金が一時的に壊れるため、ここでは案内だけして手を出さない。
    console.log(`Webhook は登録済みです: ${existing.id}`);
    console.log(
      "  署名シークレットは作成時にしか取得できません。未設定なら Stripe ダッシュボードで\n" +
        "  『署名シークレットを表示』してから `npx wrangler secret put STRIPE_WEBHOOK_SECRET` で入れてください。",
    );
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: WEBHOOK_EVENTS,
      description: "ライフプランシミュレーター（契約状態のミラー）",
      metadata: TAG,
    });
    console.log(`Webhook を作成しました: ${created.id}`);
    // 画面に出さずに wrangler へ直接渡す
    await putSecret("STRIPE_WEBHOOK_SECRET", created.secret);
  }

  // --- カスタマーポータル ---
  // 解約導線（/api/billing/portal）はこの設定が1つ有効になっていないと動かない。
  // ダッシュボードで有効化する代わりにここで作る。
  const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
  if (configs.data.some((c) => c.active)) {
    console.log("カスタマーポータルは設定済みです。");
  } else {
    const portal = await stripe.billingPortal.configurations.create({
      business_profile: {
        privacy_policy_url: "https://lifeplan.nexeed-lab.com/privacy",
        // ⚠️ 利用規約はサブプロジェクト D で作る。**本番受付の前に必ず用意して
        // ここへ足すこと。** Stripe は本番モードのポータル有効化で
        // プライバシーポリシーと利用規約の両方を求める
      },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: {
          enabled: true,
          // ⚠️ `immediately` にしない。その月の料金を払っているのに
          // 即座に使えなくなる。`at_period_end` なら Stripe 側は期末まで
          // status=active・cancel_at_period_end=true を保ち、
          // worker/billing/entitlement.ts の判定と一致する
          mode: "at_period_end",
        },
      },
    });
    console.log(`カスタマーポータルを設定しました: ${portal.id}`);
  }

  console.log("");
  console.log("--- 次にやること ---");
  console.log(`1. wrangler.jsonc の vars.STRIPE_PRICE_ID が "${price.id}" になっているか確認する`);
  console.log("2. npx wrangler secret put STRIPE_SECRET_KEY  （この鍵を貼り付ける）");
  console.log("3. npx wrangler deploy");
}

/** 値を画面に出さずに `wrangler secret put` の標準入力へ流し込む。 */
function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "secret", "put", name], {
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`${name} を投入しました（値は表示していません）。`);
        resolve();
      } else {
        reject(new Error(`wrangler secret put ${name} が終了コード ${code} で失敗しました`));
      }
    });
    child.stdin.write(value);
    child.stdin.end();
  });
}

main().catch((err) => {
  // 鍵が本文に混ざらないよう、メッセージだけを出す
  console.error("失敗しました:", err instanceof Error ? err.message : err);
  process.exit(1);
});
