import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ライフプランシミュレーター",
  description:
    "年齢・家族構成・収支から将来の資産推移を3シナリオで試算し、資産が何歳で尽きるかを可視化します。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
