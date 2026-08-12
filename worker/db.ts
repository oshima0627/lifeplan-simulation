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
