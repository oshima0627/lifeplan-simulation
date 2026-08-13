// 保存プランの D1 アクセス層。SQL はここに集約する。
//
// ⚠️⚠️ **D1 に RLS は無い。** 単一プランを触るクエリは必ず
// `WHERE id = ? AND user_id = ?` の**両方**で絞る。
// `WHERE id = ?` だけにして所有者確認を呼び出し側の JS に置くと、
// 1箇所書き忘れた瞬間に他人の家計情報が読める。
// この層の関数はすべて第2引数に userId を取る形にして、
// 「userId を渡さずに呼べる関数が存在しない」ことで構造的に防ぐ。

import { MAX_PLANS_PER_USER } from "../../shared/lifeplan/sheetValidation";

export interface PlanSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDetail extends PlanSummary {
  sheetJson: string;
  schemaVersion: number;
}

/**
 * 一覧。**`sheet_json` を返さない。**
 *
 * 一覧に全プランの入力を載せると、20件で最大160KBになる。
 * 画面が要るのは名前と日付だけ。
 */
export async function listPlans(db: D1Database, userId: string): Promise<PlanSummary[]> {
  const result = await db
    .prepare(
      "SELECT id, name, created_at, updated_at FROM plans WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .bind(userId)
    .all<{ id: string; name: string; created_at: string; updated_at: string }>();

  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** 1件取得。**他人のものは見つからない**（user_id で絞っているため）。 */
export async function findPlan(
  db: D1Database,
  userId: string,
  planId: string,
): Promise<PlanDetail | null> {
  const row = await db
    .prepare(
      "SELECT id, name, sheet_json, schema_version, created_at, updated_at FROM plans WHERE id = ? AND user_id = ?",
    )
    .bind(planId, userId)
    .first<{
      id: string;
      name: string;
      sheet_json: string;
      schema_version: number;
      created_at: string;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sheetJson: row.sheet_json,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 保存。上限に達していれば `false`。
 *
 * ⚠️ 件数を数えてから INSERT すると、同時リクエストで上限を超える。
 * `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?` で
 * **単一SQL文に畳む**（利用回数の加算と同じ作法。worker/billing/db.ts 参照）。
 */
export async function createPlan(
  db: D1Database,
  userId: string,
  input: { id: string; name: string; sheetJson: string; schemaVersion: number },
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO plans (id, user_id, name, sheet_json, schema_version, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM plans WHERE user_id = ?) < ?`,
    )
    .bind(
      input.id,
      userId,
      input.name,
      input.sheetJson,
      input.schemaVersion,
      now,
      now,
      userId,
      MAX_PLANS_PER_USER,
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * 更新。自分のプランでなければ `false`（存在しない場合と区別しない）。
 *
 * `created_at` は触らない。「いつ作ったか」は上書きで失われてよい情報ではない。
 */
export async function updatePlan(
  db: D1Database,
  userId: string,
  planId: string,
  input: { name: string; sheetJson: string; schemaVersion: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE plans SET name = ?, sheet_json = ?, schema_version = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(input.name, input.sheetJson, input.schemaVersion, new Date().toISOString(), planId, userId)
    .run();
  return result.meta.changes > 0;
}

/** 削除。自分のプランでなければ `false`。 */
export async function deletePlan(
  db: D1Database,
  userId: string,
  planId: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM plans WHERE id = ? AND user_id = ?")
    .bind(planId, userId)
    .run();
  return result.meta.changes > 0;
}
