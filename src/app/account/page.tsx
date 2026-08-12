"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe, logout } from "@/lib/auth/client";

type Status = "loading" | "loggedIn" | "loggedOut";

/**
 * ログイン状態の表示とログアウト。
 *
 * ⚠️ 静的エクスポート（output: "export"）のため、初回に生成されるHTMLは
 * 常に「確認中」の状態。レンダー中に fetchMe を呼ぶとビルド時のHTMLと
 * クライアントの初回描画が食い違い hydration 不一致になるため、マウント後の
 * useEffect の中でだけ問い合わせて差し替える（作法は AccountNav に合わせた。
 * task-4-brief.md）。
 */
export default function AccountPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((userId) => {
      if (cancelled) return;
      setStatus(userId ? "loggedIn" : "loggedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    setStatus("loggedOut");
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">アカウント</h1>

      {status === "loading" && (
        <p className="mt-6 text-sm text-slate-600">確認しています…</p>
      )}

      {status === "loggedOut" && (
        <div className="mt-6 flex flex-col gap-3 text-sm text-slate-700">
          <p>ログインしていません。</p>
          <Link
            href="/login"
            className="inline-block w-fit rounded bg-slate-900 px-4 py-2 text-white"
          >
            ログイン
          </Link>
        </div>
      )}

      {status === "loggedIn" && (
        <div className="mt-6 flex flex-col gap-3 text-sm text-slate-700">
          <p>ログインしています。</p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-fit rounded border border-slate-300 px-4 py-2 disabled:opacity-50"
          >
            {loggingOut ? "処理中…" : "ログアウト"}
          </button>
        </div>
      )}
    </main>
  );
}
