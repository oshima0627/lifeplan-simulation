import { DurableObject } from "cloudflare:workers";

/**
 * レート制限のカウンタ。識別子（IPやメールのハッシュ）ごとに1インスタンス
 * （呼び出し側が `env.RATE_LIMITER.getByName(identity)` で取得する想定）。
 *
 * なぜ KV ではなく Durable Objects か:
 * 1. **無料枠の書き込みが100倍。** KV は 1,000 writes/日、DO は 100,000 rows written/日。
 *    KV のままだと 1IP あたり約160書き込みできるため、7IPほどで枠が尽き
 *    /api/auth/* が丸ごと 500 になる（`worker/rateLimit.ts` 参照）
 * 2. **原子的になる。** 同一DOへのリクエストは直列化されるので read→write の間に
 *    割り込まれない。KV 版が「競合するとカウントが1回分落ちる」と割り切っていた
 *    問題が構造的に消える
 *
 * ⚠️ 無料枠では SQLite バックエンドが必須。呼び出し側の wrangler.jsonc の
 * migrations で `new_sqlite_classes` として宣言すること（`new_classes` は
 * 旧来のKVバックエンドで、無料枠では使えない）。このファイル自体は
 * `ctx.storage.sql` だけを使い、`ctx.storage.get`/`put` 系のKVストレージAPIは
 * 使わない。
 */
export class RateLimiter extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // スキーマ初期化はコンストラクタの中で blockConcurrencyWhile を使う
    // （公式のベストプラクティス）。コンストラクタは async にできないため
    // await はしないが、このコールバックには await を挟む処理が無いので
    // 同期的に最後まで実行され、コンストラクタが返る時点でテーブルは
    // 必ず存在する。
    //
    // scope（"signup" / "login" など）ごとに1行。日付が変わったときの
    // リセットは行を消さず date 列で判定するので、TTL列は持たない。
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS counters (
          scope TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          count INTEGER NOT NULL
        )
      `);
    });
  }

  /**
   * 上限未満なら許可してカウンタを+1、上限に達していたら拒否する。
   *
   * - 日付（UTC, YYYYMMDD）が前回と変わっていれば、行を消さずにカウントを
   *   0として扱う（次に許可されたときの書き込みで date・count とも上書きされる）
   * - 上限に達したときは書き込まない（KV版 `checkAndBump` と同じ判断。
   *   拒否され続けるリクエストのたびに書き込みが積み重なるのを避ける）
   * - 壊れた値・負の値が保存されていた場合は0として扱う（本来この行を書くのは
   *   このメソッドだけなので起こらないはずだが、防御的に扱う）
   * - 呼び出しのたびに（許可・拒否を問わず）48時間後の掃除アラームを
   *   延長する。詳しくは `alarm()` を参照
   */
  async checkAndBump(
    key: string,
    limit: number,
    // このDOでは上限判定・リセットは date 列だけで行い、行ごとのTTLは持たない
    // （下記 alarm() が担う「最終利用から48時間」はDOインスタンス単位の掃除で、
    // scopeごとの日次カウンタとは別の話）。したがって ttlSeconds はこの
    // メソッドの中では使わない。KV版の `checkAndBump(kv, key, limit, ttlSeconds)`
    // と同じ引数の並びを維持し、呼び出し側の切り替えを1行で済ませるために
    // 引数だけ残している。
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 上記コメント参照
    ttlSeconds: number,
  ): Promise<boolean> {
    const today = todayUtc();

    const existing = this.ctx.storage.sql
      .exec<CounterRow>("SELECT date, count FROM counters WHERE scope = ?", key)
      .toArray()[0];

    const current = existing && existing.date === today ? parseCount(existing.count) : 0;

    // 許可・拒否のどちらでも「このDOが使われた」ことに変わりはないため、
    // 掃除アラームはここで無条件に延長する。
    await this.ctx.storage.setAlarm(Date.now() + CLEANUP_AFTER_MS);

    if (current >= limit) {
      return false;
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO counters (scope, date, count) VALUES (?, ?, ?)",
      key,
      today,
      current + 1,
    );
    return true;
  }

  /**
   * 最終利用から48時間後に呼ばれる（`checkAndBump` が毎回 `setAlarm` で
   * 延長する）。DOのストレージを丸ごと消す。
   *
   * 放置すると、レート制限の対象になったIP・メールの数だけDOインスタンスが
   * 増え続け、無料枠のストレージ・SQL行数を無駄に消費し続けるため、
   * 使われなくなったインスタンスを掃除する。
   */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

// `ctx.storage.sql.exec<T>` の型引数は `Record<string, SqlStorageValue>` を
// 満たす必要がある（`SqlStorageValue = ArrayBuffer | string | number | null`）。
// `interface` のままだとインデックスシグネチャが無く制約を満たさないため、
// 明示的に持たせる。
interface CounterRow {
  [column: string]: SqlStorageValue;
  date: string;
  count: number;
}

// 最終利用（checkAndBump の呼び出し）から掃除アラームまでの猶予。48時間。
const CLEANUP_AFTER_MS = 48 * 60 * 60 * 1000;

// UTC基準の日付を YYYYMMDD で返す。呼び出しごとにこれを見て、前回と違えば
// カウントを0として扱う（`worker/rateLimit.ts` の todayUtc と同じ考え方だが、
// このファイルは新規2ファイルだけという制約のもとで既存ファイルへの依存を
// 増やさないよう、あえて自前で持つ）。
function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// 保存されている count を安全な非負整数として扱う。壊れた値・負の値は0とみなす。
function parseCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
