// KVによる日次レート制限。
//
// 移植元: projects/pre-meet/apps/worker/src/guard.ts。考え方だけを借りる
// （あちらは匿名/ログイン済み/IPの3層＋サーキットブレーカーだが、本プロジェクトは
// キーと上限を受け取るだけの `checkAndBump` 1つで足りる）。
//
// ⚠️ KV には原子的インクリメントが無い。`get` → `put` の2ステップで近似するため、
// 同時にリクエストが来ると読み取りが競合し、カウントが1回分落ちることがある
// （加算が失われる、いわゆる lost update）。ここでは許容する。レート制限は
// 「おおよそ」で機能すれば十分で、厳密な上限管理が必要なのは回数ではなく金額
// （課金・クレジット消費）の方だから。金額を扱う処理でこの近似を使い回さないこと。

// Cloudflare Workers KV バインディング相当の最小インターフェース。
// テストでは Map ベースの偽実装に差し替える。
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// checkAndBump のデフォルトTTL。日次カウンタなので24時間で十分だが、
// 呼び出し時刻とUTC日境界のずれで直前のカウンタが早く消えて上限をすり抜けない
// よう、少し余裕を持たせる。
const DEFAULT_TTL_SECONDS = 26 * 60 * 60;

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

function parseCount(raw: string | null): number {
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// 上限未満なら許可してカウンタを+1、上限に達していたら拒否する。
//
// 拒否したときはKVに書き込まない。ここで加算してしまうと、上限超過中の
// リクエストが来るたびにTTLが延長され、拒否され続ける限りカウンタが
// 実質的に無期限化してしまう（本来は日が変われば自然に消えてほしい）。
export async function checkAndBump(
  kv: KvStore,
  key: string,
  limit: number,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  const current = parseCount(await kv.get(key));
  if (current >= limit) return false;
  await kv.put(key, String(current + 1), { expirationTtl: ttlSeconds });
  return true;
}
