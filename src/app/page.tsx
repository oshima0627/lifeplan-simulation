import Link from "next/link";
import { Simulator } from "@/components/Simulator";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">ライフプランシミュレーター</h1>
        <p className="mt-2 text-sm text-slate-600">
          年齢・収支・家族構成から将来の資産推移を試算し、
          <strong>資産が何歳で尽きるか</strong>を楽観・普通・悲観の3シナリオで確かめます。
        </p>
        <p className="mt-2 text-xs text-slate-500">
          入力内容はお使いのブラウザにのみ保存され、サーバーには送信されません。
          <Link href="/privacy" className="ml-1 underline">
            プライバシーについて
          </Link>
        </p>
      </header>
      <Simulator />
    </main>
  );
}
