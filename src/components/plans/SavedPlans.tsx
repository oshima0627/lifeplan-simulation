"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMe } from "@/lib/auth/client";
import type { HearingSheet } from "@/lib/lifeplan/types";
import {
  createPlan,
  deletePlan,
  listPlans,
  loadPlan,
  type PlanSummary,
} from "@/lib/plans/client";

interface Props {
  /** 保存する現在の入力。 */
  sheet: HearingSheet;
  /** 読み込んだ入力をフォームへ反映する。 */
  onLoad: (sheet: HearingSheet) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 保存と履歴。
 *
 * ⚠️ **ログインしている人にだけ出す。** 未ログインで押させてから 401 を返すのは
 * 不親切なうえ、「保存できる」と誤解させたまま入力を失わせる。
 *
 * ⚠️ 静的エクスポート（output: "export"）なので、初回HTMLは常に「確認中」。
 * レンダー中に問い合わせると hydration 不一致になるため、マウント後の
 * useEffect でだけ確認する（AccountNav / PlanCard と同じ作法）。
 */
export default function SavedPlans({ sheet, onLoad }: Props) {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listPlans();
    if (result.ok) {
      setPlans(result.value.plans);
      setLimit(result.value.limit);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((userId) => {
      if (cancelled) return;
      setLoggedIn(userId !== null);
      if (userId !== null) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (loggedIn !== true) return null;

  async function handleSave() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await createPlan({ name, sheet });
    if (result.ok) {
      setName("");
      setNotice("保存しました。");
      await refresh();
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  async function handleLoad(plan: PlanSummary) {
    // ⚠️ 読み込みは現在の入力を上書きする。取り返しがつかないので確認する
    const label = plan.name || formatDate(plan.createdAt);
    if (!window.confirm(`「${label}」を読み込みます。今の入力は失われます。よろしいですか？`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await loadPlan(plan.id);
    if (result.ok) {
      onLoad(result.value.sheet);
      setNotice(`「${label}」を読み込みました。`);
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  async function handleDelete(plan: PlanSummary) {
    const label = plan.name || formatDate(plan.createdAt);
    if (!window.confirm(`「${label}」を削除します。元に戻せません。よろしいですか？`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await deletePlan(plan.id);
    if (result.ok) {
      setNotice(`「${label}」を削除しました。`);
      await refresh();
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  return (
    <section className="rounded border border-slate-200 p-4">
      <h2 className="text-sm font-bold text-slate-900">保存した試算</h2>
      <p className="mt-1 text-xs text-slate-500">
        保存を押したときだけ、入力内容がサーバーに送られます。
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前（任意）"
          maxLength={50}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="shrink-0 rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          保存
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="mt-2 text-xs text-slate-600">{notice}</p>}

      {plans.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">まだ保存はありません。</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {plans.map((plan) => (
            <li key={plan.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {plan.name || formatDate(plan.createdAt)}
              </span>
              <span className="shrink-0 text-xs text-slate-400">
                {formatDate(plan.updatedAt)}
              </span>
              <button
                type="button"
                onClick={() => handleLoad(plan)}
                disabled={busy}
                className="shrink-0 text-xs text-slate-600 underline hover:text-slate-900 disabled:opacity-50"
              >
                読み込む
              </button>
              <button
                type="button"
                onClick={() => handleDelete(plan)}
                disabled={busy}
                className="shrink-0 text-xs text-slate-500 underline hover:text-red-700 disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {limit !== null && (
        <p className="mt-2 text-xs text-slate-400">
          {plans.length} / {limit} 件
        </p>
      )}
    </section>
  );
}
