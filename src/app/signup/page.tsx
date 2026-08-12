import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = {
  title: "新規登録 | ライフプランシミュレーター",
};

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">新規登録</h1>

      <div className="mt-6">
        <AuthForm mode="signup" />
      </div>

      <p className="mt-6 text-sm text-slate-600">
        すでにアカウントをお持ちの方は
        <Link href="/login" className="ml-1 underline">
          ログイン
        </Link>
      </p>
    </main>
  );
}
