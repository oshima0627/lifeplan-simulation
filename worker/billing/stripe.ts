import Stripe from "stripe";
import type { AppEnv } from "../env";

/**
 * Stripe クライアントを作る。
 *
 * ⚠️ **Workers 固有の落とし穴をここに封じ込める。**
 * 以下はいずれも「ローカルの Node では動くが本番でだけ壊れる」種類の問題で、
 * テストをすり抜ける。姉妹プロジェクト pre-meet で実際に踏んで解決済み。
 *
 * 1. **HTTP クライアント** — Stripe SDK の既定は Node の `http` モジュールを使う。
 *    Workers にはこれが無く、"An error occurred with our connection to Stripe" で
 *    落ちる。`Stripe.createFetchHttpClient()` を明示指定する。
 * 2. **署名検証** — 同期版 `webhooks.constructEvent` は Node の `crypto` に依存する。
 *    Workers では `constructEventAsync` + `Stripe.createSubtleCryptoProvider()` を使う
 *    （webhook.ts 側で対応）。
 *
 * `apiVersion` を固定しないのは、SDK に同梱された版を使わせるため。
 * 明示指定すると SDK の型と実際の応答がズレた時に気づけない。
 */
export function getStripe(env: AppEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY が未設定です");
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
