-- 保存されたプラン（サブプロジェクト E）。
--
-- ⚠️ 0001_init.sql の「家計情報を D1 に保存しない」という方針を、
-- 利用者本人の判断（2026-08-13）で覆している。
-- 代わりに「**保存を押さないかぎりサーバーには送らない**」を新しい約束にした。
-- 既定は今までどおりブラウザの localStorage のみで、明示的な保存だけがここへ来る。
--
-- この変更にあわせて、トップページとプライバシーポリシーの記述も直すこと。
-- 書き換えずに出すと、公開している約束と実際の挙動が食い違う。

CREATE TABLE plans (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  -- 利用者が付ける名前。空文字なら画面側で日付を代わりに出す
  name       TEXT NOT NULL,
  -- HearingSheet の JSON。
  -- ⚠️ 計算結果（年次の資産推移・枯渇年齢）は入れない。入力から再計算できるうえ、
  -- 保存しておくとエンジンを直したときに古い結果が残り、表示と実態が食い違う。
  sheet_json TEXT NOT NULL,
  -- 入力の形が将来変わったときに古い行を見分けるため。
  -- これが無いと、項目を増やした後に古い行を読んで黙って壊れる
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 一覧は user_id で引き、更新の新しい順に出す
CREATE INDEX idx_plans_user ON plans(user_id, updated_at DESC);
