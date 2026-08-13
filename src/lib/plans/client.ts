// 保存プランAPIを叩くブラウザ側クライアント。
//
// ⚠️ `credentials: "same-origin"` を必ず付ける。付けないとセッション Cookie が
// 送られず全て 401 になる（src/lib/auth/client.ts と同じ理由）。
//
// ⚠️ 例外を外に投げない。通信の失敗もサーバーのエラーも結果型で返す。
// 画面が落ちるより、エラー表示のほうが良い。

import type { HearingSheet } from "@/lib/lifeplan/types";
import { isStorableSheet } from "../../../shared/lifeplan/sheetValidation";

export interface PlanSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type PlanResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const NETWORK_ERROR = {
  ok: false as const,
  code: "NETWORK_ERROR",
  message: "通信に失敗しました。ネットワークの状態を確認してからもう一度お試しください",
};

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function call<T>(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<PlanResult<T>> {
  let status: number;
  let body: unknown;
  try {
    const res = await fetchImpl(input, { ...init, credentials: "same-origin" });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    return NETWORK_ERROR;
  }

  if (status >= 200 && status < 300) return { ok: true, value: body as T };

  // サーバーの文言をそのまま使う。「保存できるのは20件までです」のような
  // 分岐ごとの案内を、ここで言い換えると崩れる
  const error = (body as ErrorBody | null)?.error;
  return {
    ok: false,
    code: typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR",
    message: typeof error?.message === "string" ? error.message : "エラーが発生しました",
  };
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/** 保存済みプランの一覧。 */
export function listPlans(
  fetchImpl: typeof fetch = fetch,
): Promise<PlanResult<{ plans: PlanSummary[]; limit: number }>> {
  return call(fetchImpl, "/api/plans", { method: "GET" });
}

/** 現在の入力を保存する。 */
export function createPlan(
  input: { name: string; sheet: HearingSheet },
  fetchImpl: typeof fetch = fetch,
): Promise<PlanResult<{ id: string }>> {
  return call(fetchImpl, "/api/plans", jsonInit("POST", input));
}

/** 保存済みプランを削除する。 */
export function deletePlan(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlanResult<{ ok: true }>> {
  return call(fetchImpl, `/api/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * 保存済みプランを読み込む。
 *
 * ⚠️ サーバーは保存時に検証しているが、ここでも形を確かめる。
 * 入力の項目を増やしたのに古い行が残っている場合、検証を挟まずに
 * フォームへ流すと画面が壊れる。**読めないものは読めないと言う**ほうがまだ良い。
 */
export async function loadPlan(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlanResult<{ name: string; sheet: HearingSheet }>> {
  const result = await call<{ name: string; sheet: unknown }>(
    fetchImpl,
    `/api/plans/${encodeURIComponent(id)}`,
    { method: "GET" },
  );
  if (!result.ok) return result;

  if (!isStorableSheet(result.value.sheet)) {
    return {
      ok: false,
      code: "PLAN_INCOMPATIBLE",
      message: "この保存内容は現在の入力形式では読み込めません",
    };
  }
  return {
    ok: true,
    value: { name: result.value.name, sheet: result.value.sheet as HearingSheet },
  };
}
