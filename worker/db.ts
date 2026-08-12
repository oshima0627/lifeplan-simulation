// 認証まわりの D1 アクセス層。SQL をここに集約する（原子性・冪等性をどこで
// 担保しているかを追えなくなるのを避けるため、呼び出し側で SQL を組み立てない）。
//
// ⚠️ すべて db.prepare(...).bind(...) を使う。文字列連結で SQL を組まない
// （SQLインジェクション対策）。

/**
 * ユーザーを作成する。
 *
 * メール重複時は例外を投げず `false` を返す。呼び出し側（Task 6）が
 * 「このメールは登録済みです」のような、登録済みアドレスの洗い出しに使える
 * 文言を出さないようにするため（呼び出し側は true/false だけを見て、
 * 未登録の場合と同じ形の応答を返す）。
 *
 * 重複判定は `INSERT OR IGNORE` の `changes` で行う。単一SQL文なので
 * SQLiteエンジン内で原子的に処理され、競合状態にも強い。`users` には
 * `UNIQUE(email)` 以外の一意制約が無いため、`changes === 0` の原因は
 * 重複以外にありえない。接続断などの本当の異常は `run()` 自体が reject
 * するので、そちらは握りつぶさずそのまま投げ直る。
 */
export async function createUser(
  db: D1Database,
  input: { id: string; email: string; passwordHash: string },
): Promise<boolean> {
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(input.id, input.email, input.passwordHash, new Date().toISOString())
    .run();
  return result.meta.changes > 0;
}

/** メールアドレス（正規化済み前提）でユーザーを引く。見つからなければ null。 */
export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<{ id: string; passwordHash: string } | null> {
  const row = await db
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row) return null;
  return { id: row.id, passwordHash: row.password_hash };
}

/** セッションを作成する。生トークンではなくハッシュ済みの値を保存する。 */
export async function createSession(
  db: D1Database,
  input: { tokenHash: string; userId: string; expiresAt: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(input.tokenHash, input.userId, input.expiresAt)
    .run();
}

/**
 * セッショントークンのハッシュからユーザーIDを引く。
 *
 * `expires_at > ?`（現在時刻のISO文字列）を条件に含めるため、期限切れの
 * セッションは行ごと候補から外れ null になる。呼び出し側で期限を判定させると
 * 判定漏れが起きうるため、ここで確定させる。
 */
export async function findUserIdBySession(
  db: D1Database,
  tokenHash: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, new Date().toISOString())
    .first<{ user_id: string }>();
  return row ? row.user_id : null;
}

/** セッションを削除する（ログアウト）。存在しないトークンでも冪等に成功する。 */
export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

/** パスワード再設定トークンを作成する。生トークンではなくハッシュ済みの値を保存する。 */
export async function createPasswordReset(
  db: D1Database,
  input: { tokenHash: string; userId: string; expiresAt: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(input.tokenHash, input.userId, input.expiresAt)
    .run();
}

/**
 * パスワード再設定トークンを検証すると同時に使用済みにする。有効なら `userId` を返す。
 *
 * ⚠️ 「検証してから使用済みにする」の2ステップにしないこと。その間に同じ
 * トークンで再度検証が通ると、1つのトークンを2回使える窓ができる
 * （メール漏洩時などに再設定リンクを踏まれた場合の被害が倍になる）。
 *
 * `UPDATE ... WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?` という
 * 単一SQL文にすることで、「未使用かつ期限内かの判定」と「使用済みにする」を
 * SQLiteエンジン内で原子的に行う。同時に同じトークンで2回呼ばれても、
 * `meta.changes` が 1 になるのはどちらか一方だけ（`createUser` の重複判定と同じ考え方）。
 *
 * `changes === 0` の場合は「そもそも存在しない／既に使用済み／期限切れ」の
 * いずれかであり、区別せず null を返す（区別すると「このトークンは存在した」
 * という情報が漏れる）。
 */
export async function consumePasswordReset(
  db: D1Database,
  tokenHash: string,
  now: Date = new Date(),
): Promise<string | null> {
  const nowIso = now.toISOString();
  const result = await db
    .prepare(
      "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    )
    .bind(nowIso, tokenHash, nowIso)
    .run();
  if (result.meta.changes === 0) return null;

  // ここに来た時点で既に使用済みへの更新は完了している。以降の SELECT は
  // 「誰の再設定だったか」を読み出すだけで、上の原子性には影響しない
  // （user_id はこの行が作られてから変わることがないため）。
  const row = await db
    .prepare("SELECT user_id FROM password_resets WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ user_id: string }>();
  return row ? row.user_id : null;
}

/**
 * パスワード再設定トークンを**消費せずに**照会する。有効（未使用かつ期限内）なら、
 * そのトークンに紐づくユーザーのメールアドレスを返す。
 *
 * ⚠️ `consumePasswordReset` とは別の関数にしてあること自体が不変条件。
 * こちらは `used_at` を更新しない（SELECT のみ）。呼び出し側
 * （`GET /api/auth/reset-token`）はトークンの持ち主に自分のメールアドレスを
 * 確認させるための照会用エンドポイントであり、ここで使用済みにしてしまうと
 * その後の本来の再設定（`POST /api/auth/reset-password`）が
 * RESET_TOKEN_INVALID で失敗するようになる。
 *
 * `consumePasswordReset` と同じく「未使用かつ期限内」の判定条件を揃える
 * （`used_at IS NULL AND expires_at > ?`）。存在しない／使用済み／期限切れの
 * いずれであっても区別せず null を返す（区別すると「このトークンは存在した」
 * という情報が漏れる）。
 */
export async function findEmailForValidPasswordReset(
  db: D1Database,
  tokenHash: string,
  now: Date = new Date(),
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT users.email AS email
       FROM password_resets
       JOIN users ON users.id = password_resets.user_id
       WHERE password_resets.token_hash = ?
         AND password_resets.used_at IS NULL
         AND password_resets.expires_at > ?`,
    )
    .bind(tokenHash, now.toISOString())
    .first<{ email: string }>();
  return row ? row.email : null;
}

/** パスワードハッシュを更新する（再設定完了時）。 */
export async function updatePasswordHash(
  db: D1Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, userId).run();
}

/**
 * 指定ユーザーの全セッションを削除する。
 *
 * パスワード再設定の直後に呼ぶ。再設定の動機は「乗っ取られたかもしれない」
 * であることが多く、既存セッションを生かしたままにすると再設定した意味がない。
 */
export async function deleteAllSessionsForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
