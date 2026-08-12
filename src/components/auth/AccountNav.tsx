"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe, logout } from "@/lib/auth/client";

/**
 * ログイン状態を表示するナビゲーション。
 *
 * ⚠️ 静的エクスポート（output: "export"）のため、初回に生成されるHTMLは
 * 常に「未ログイン」の状態。レンダー中に `fetchMe` を呼ぶと、ビルド時の
 * HTML（未ログイン）とクライアントの初回描画が食い違い hydration 不一致に
 * なるため、マウント後の `useEffect` の中でだけ問い合わせて差し替える
 * （作法は src/components/Simulator.tsx の localStorage 読み込みに合わせた）
 */
export function AccountNav() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((id) => {
      if (cancelled) return;
      setUserId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setUserId(null);
    setLoggingOut(false);
  }

  if (userId) {
    return (
      <nav className="flex items-center gap-3 text-sm">
        <Link href="/account" className="underline">
          アカウント
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="underline disabled:opacity-50"
        >
          ログアウト
        </button>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-3 text-sm">
      <Link href="/login" className="underline">
        ログイン
      </Link>
      <Link href="/signup" className="underline">
        登録
      </Link>
    </nav>
  );
}
