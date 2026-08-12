import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = {
  title: "ログイン | ライフプランシミュレーター",
};

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">ログイン</h1>

      <div className="mt-6">
        <AuthForm mode="login" />
      </div>

      <div className="mt-6 flex flex-col gap-2 text-sm text-slate-600">
        <p>
          アカウントをお持ちでない方は
          <Link href="/signup" className="ml-1 underline">
            新規登録
          </Link>
        </p>
        <p>
          <Link href="/forgot-password" className="underline">
            パスワードを忘れた方はこちら
          </Link>
        </p>
      </div>
    </main>
  );
}
