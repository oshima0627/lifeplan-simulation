import type { RateLimiter } from "./rateLimitDo";

// Durable Objects による日次レート制限。
//
// 元は KV（`get` → `put` の2ステップで近似、競合すると加算が1回分落ちる
// lost update を許容する設計）だったが、Workers Free の KV 書き込み上限
// （1,000 writes/日）だと 1IP あたり約160書き込みで枠が尽き `/api/auth/*`
// が丸ごと 500 になるため、Durable Objects（`worker/rateLimitDo.ts` の
// `RateLimiter`）へ移した。DO は同一インスタンスへのリクエストが直列化
// されるため read→write の間に割り込まれず、lost update も起こらない。
// 書き込み上限も 100,000 rows/日と KV の100倍あるため、無料枠のままで足りる。
//
// 判定ロジック（境界・非加算・壊れた値の扱い）は KV版と完全に一致するよう
// `RateLimiter.checkAndBump` 側で作られている（レビュー済み）。

// checkAndBump のデフォルトTTL。DO版では `RateLimiter.checkAndBump` が
// date列だけで日次リセットを判断し、このTTLは内部では使わない
// （行ごとの掃除は `RateLimiter.alarm` が最終利用から48時間で行う）。
// それでも呼び出し側のシグネチャ・デフォルト値をKV版から変えずに保つため、
// パラメータとしては残す。
const RATE_LIMIT_TTL_SECONDS = 26 * 60 * 60;

// IPやメールアドレスなど生の値をKVキーに使わないためのハッシュ化。
// KVのキーは運用画面（Cloudflareダッシュボード）から見えうるため、
// 生PIIをそのままキーにしない。SHA-256を16進数の先頭16文字（64bit）に
// 短縮する。衝突してもレート制限が多少甘くなる/厳しくなるだけで、
// 秘匿性が目的の値ではないため十分な長さ。
export async function hashForKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// UTC基準の日付を YYYYMMDD で返す。呼び出し側がこれをKVキーに含めることで、
// 日が変われば自然に別カウンタになる（TTLはあくまで掃除用の保険）。
export function todayUtc(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// 上限未満なら許可してカウンタを+1、上限に達していたら拒否する。
//
// 判定・非加算の詳細は `RateLimiter.checkAndBump`（worker/rateLimitDo.ts）
// 側の実装とコメントを参照（KV版と完全に一致することをレビュー済み）。
export async function checkAndBump(
  ns: DurableObjectNamespace<RateLimiter>,
  key: string,
  limit: number,
  ttlSeconds: number = RATE_LIMIT_TTL_SECONDS,
): Promise<boolean> {
  // 識別子ごとに別インスタンスにする。IPごと・メールごとに独立するので
  // 互いに待たされない
  const stub = ns.get(ns.idFromName(key));
  return stub.checkAndBump(key, limit, ttlSeconds);
}
