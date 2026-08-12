import type { Metadata } from "next";
import Link from "next/link";
import { AccountNav } from "@/components/auth/AccountNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ライフプランシミュレーター",
  description:
    "年齢・家族構成・収支から将来の資産推移を3シナリオで試算し、資産が何歳で尽きるかを可視化します。",
};

// ⚠️ layout.tsx はサーバーコンポーネント。ヘッダーに置く AccountNav は
// "use client" 側（src/components/auth/AccountNav.tsx）でフックを使うので
// そのまま子として読み込める（layout自体をクライアント化する必要はない）。
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-sm font-semibold text-slate-900">
              ライフプランシミュレーター
            </Link>
            <AccountNav />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
