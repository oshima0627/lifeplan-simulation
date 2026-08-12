"use client";

import { useEffect, useState } from "react";
import {
  type BillingStatus,
  fetchBillingStatus,
  openPortal,
  startCheckout,
} from "@/lib/billing/client";

/**
 * 表示用の月額。
 *
 * ⚠️ **請求額はここではなく Stripe の Price が決める。** この定数は表示専用で、
 * Stripe 側の価格を変えたらここも必ず直すこと。食い違うと、表示と請求が
 * 違うという特定商取引法上まずい状態になる。
 */
const MONTHLY_PRICE_JPY = 1980;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 契約状態と、契約・解約への導線。
 *
 * ⚠️ 上限回数・残り回数はサーバーが返した値をそのまま出す。画面側で
 * 計算し直すと、サーバーの判定（worker/billing/entitlement.ts）と
 * 食い違って「残っているのに使えない」が起きる。
 */
export default function PlanCard() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBillingStatus().then((result) => {
      if (cancelled) return;
      if (result.ok) setStatus(result.value);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Checkout / ポータルはどちらも Stripe のページへ遷移する。
  // 遷移するので busy を戻さない（戻すと二度押しできてしまう）
  async function go(action: typeof startCheckout) {
    setBusy(true);
    setError(null);
    const result = await action();
    if (result.ok) {
      window.location.href = result.value.url;
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  if (error && !status) {
    return <p className="mt-6 text-sm text-red-700">{error}</p>;
  }
  if (!status) {
    return <p className="mt-6 text-sm text-slate-600">プランを確認しています…</p>;
  }

  const periodEnd = formatDate(status.currentPeriodEnd);

  return (
    <section className="mt-8 rounded border border-slate-200 p-4">
      <h2 className="text-lg font-bold text-slate-900">AIアドバイス</h2>

      <p className="mt-2 text-sm text-slate-700">
        {status.paid ? "ご契約中です。" : `月額 ${MONTHLY_PRICE_JPY.toLocaleString()}円（税込）`}
      </p>

      <p className="mt-1 text-sm text-slate-600">
        今月の残り {status.remaining} 回 / {status.limit} 回
      </p>

      {status.paid && status.cancelAtPeriodEnd && periodEnd && (
        <p className="mt-2 text-sm text-amber-700">
          解約の予約が入っています。{periodEnd} まではご利用いただけます。
        </p>
      )}
      {status.paid && !status.cancelAtPeriodEnd && periodEnd && (
        <p className="mt-2 text-sm text-slate-600">次回のお支払いは {periodEnd} です。</p>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        onClick={() => go(status.paid ? openPortal : startCheckout)}
        disabled={busy}
        className={
          status.paid
            ? "mt-4 w-fit rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
            : "mt-4 w-fit rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        }
      >
        {busy ? "処理中…" : status.paid ? "プランを管理" : "契約する"}
      </button>

      {!status.paid && (
        <p className="mt-3 text-xs text-slate-500">
          いつでも解約できます。自動更新で、解約するまで毎月お支払いが発生します。
        </p>
      )}
    </section>
  );
}
