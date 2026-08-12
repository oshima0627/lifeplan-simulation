-- 認証の土台（docs/superpowers/specs/2026-08-12-paid-ai-advisor-design.md §9）。
--
-- ここに入るのは認証・課金・利用回数だけ。
-- 年収・資産額・家族構成といった家計情報は D1 に保存しない（設計書 §5.3）。
-- localStorage に置いたままにすることで、漏洩時の被害を認証情報だけに限定する。

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  -- 正規化済み（trim + 小文字）。正規化のルールはクライアントと共有する
  email         TEXT NOT NULL UNIQUE,
  -- 形式: pbkdf2c-v<kdfVersion>$<salt_b64url>$<digest_b64url>
  -- パスワード本体もブラウザで導出した鍵も、そのままの形では保存しない
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  -- 生のトークンは保存しない。DB が漏れてもセッションを復元できないようにする
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- ログアウト時に user_id で引くため
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 期限切れの一括削除で使う
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE password_resets (
  -- セッションと同じく、生トークンは保存しない
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  -- 使用済みを記録する。NULL なら未使用。
  -- 行を消すのではなく使用済みを残すのは、「一度使ったリンクを再度踏んだ」場合に
  -- 「期限切れ」ではなく「使用済み」と正しく案内するため
  used_at    TEXT
);

CREATE INDEX idx_password_resets_user ON password_resets(user_id);
