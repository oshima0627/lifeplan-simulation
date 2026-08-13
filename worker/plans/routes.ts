import { currentUserId } from "../auth/current";
import type { AppEnv } from "../env";
import { errorResponse, json } from "../http";
import {
  MAX_PLANS_PER_USER,
  MAX_SHEET_BYTES,
  SHEET_SCHEMA_VERSION,
  isStorableSheet,
  normalizePlanName,
  utf8ByteLength,
} from "../../shared/lifeplan/sheetValidation";
import { createPlan, deletePlan, findPlan, listPlans, updatePlan } from "./db";

const PREFIX = "/api/plans";

/** 認証必須。未ログインは 401。 */
function unauthorized(): Response {
  return errorResponse("UNAUTHORIZED", "ログインしてください", 401);
}

/**
 * 見つからない。
 *
 * ⚠️ **他人のプランを指定された場合もこれを返す（403 ではない）。**
 * 403 は「その ID は存在するが権限が無い」と伝えてしまい、
 * 総当たりで他人のプランの有無を数えられる。
 */
function notFound(): Response {
  return errorResponse("NOT_FOUND", "プランが見つかりません", 404);
}

/** リクエスト本文から、保存してよい形の入力を取り出す。 */
async function readPlanBody(
  request: Request,
): Promise<{ name: string; sheetJson: string } | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;

  const { name, sheet } = body as { name?: unknown; sheet?: unknown };

  const normalizedName = normalizePlanName(name === undefined ? "" : name);
  if (normalizedName === null) return null;

  if (!isStorableSheet(sheet)) return null;

  // ⚠️ 検証を通った後の JSON で長さを測る。受け取った生文字列ではなく
  // 実際に保存する文字列を測らないと、上限をすり抜ける
  const sheetJson = JSON.stringify(sheet);
  if (utf8ByteLength(sheetJson) > MAX_SHEET_BYTES) return null;

  return { name: normalizedName, sheetJson };
}

function invalidInput(): Response {
  return errorResponse("INVALID_INPUT", "入力が不正です", 400);
}

async function handleList(_request: Request, env: AppEnv, userId: string): Promise<Response> {
  return json({ plans: await listPlans(env.DB, userId), limit: MAX_PLANS_PER_USER });
}

async function handleCreate(request: Request, env: AppEnv, userId: string): Promise<Response> {
  const input = await readPlanBody(request);
  if (!input) return invalidInput();

  const id = crypto.randomUUID();
  const created = await createPlan(env.DB, userId, {
    id,
    name: input.name,
    sheetJson: input.sheetJson,
    schemaVersion: SHEET_SCHEMA_VERSION,
  });
  if (!created) {
    return errorResponse(
      "PLAN_LIMIT_REACHED",
      `保存できるのは${MAX_PLANS_PER_USER}件までです。不要なものを削除してください`,
      409,
    );
  }
  return json({ id }, 201);
}

async function handleGet(env: AppEnv, userId: string, planId: string): Promise<Response> {
  const plan = await findPlan(env.DB, userId, planId);
  if (!plan) return notFound();

  // 保存時に検証しているので通常は通る。ここで壊れているのは、
  // 入力の形を変えたのに schema_version を上げ忘れた場合。
  // 画面を壊すより「読めません」と言うほうがまだ良い
  let sheet: unknown;
  try {
    sheet = JSON.parse(plan.sheetJson) as unknown;
  } catch {
    return errorResponse("PLAN_CORRUPTED", "保存内容を読み取れませんでした", 500);
  }

  return json({
    id: plan.id,
    name: plan.name,
    sheet,
    schemaVersion: plan.schemaVersion,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  });
}

async function handleUpdate(
  request: Request,
  env: AppEnv,
  userId: string,
  planId: string,
): Promise<Response> {
  const input = await readPlanBody(request);
  if (!input) return invalidInput();

  const updated = await updatePlan(env.DB, userId, planId, {
    name: input.name,
    sheetJson: input.sheetJson,
    schemaVersion: SHEET_SCHEMA_VERSION,
  });
  return updated ? json({ ok: true }) : notFound();
}

async function handleDelete(env: AppEnv, userId: string, planId: string): Promise<Response> {
  return (await deletePlan(env.DB, userId, planId)) ? json({ ok: true }) : notFound();
}

/**
 * `/api/plans` と `/api/plans/{id}` のディスパッチ。
 *
 * 既存のルータ（auth / billing）は完全一致の表で引いているが、
 * ここは ID がパスに入るため自前で分ける。
 */
export async function handlePlansRoute(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;

  // ⚠️ 認証をルータの入口で1回だけ行う。各ハンドラに任せると、
  // 追加したハンドラで書き忘れて認証なしのエンドポイントが生まれる
  const userId = await currentUserId(request, env);
  if (!userId) return unauthorized();

  if (url.pathname === PREFIX) {
    if (request.method === "GET") return handleList(request, env, userId);
    if (request.method === "POST") return handleCreate(request, env, userId);
    return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
  }

  const planId = decodeURIComponent(url.pathname.slice(PREFIX.length + 1));
  // `/api/plans/` や `/api/plans/a/b` は受け付けない
  if (!planId || planId.includes("/")) return notFound();

  if (request.method === "GET") return handleGet(env, userId, planId);
  if (request.method === "PUT") return handleUpdate(request, env, userId, planId);
  if (request.method === "DELETE") return handleDelete(env, userId, planId);
  return errorResponse("METHOD_NOT_ALLOWED", "許可されていないメソッドです", 405);
}
