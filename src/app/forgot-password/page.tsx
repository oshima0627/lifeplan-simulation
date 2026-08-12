"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestPasswordReset } from "@/lib/auth/client";

/**
 * メールアドレス入力 → 再設定メールの送信依頼。
 *
 * ⚠️ 送信後の文言は、アドレスが登録済みかどうかで変えない。
 * `requestPasswordReset`（src/lib/auth/client.ts）自体がサーバーの応答を
 * 戻り値に反映しない設計（常に200を返すAPIに合わせて void を返すだけ）
 * になっているので、ここでも分岐を作らず常に同じ文言を表示する
 * （崩すと登録済みアドレスの洗い出しに使われる。task-4-brief.md）。
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await requestPasswordReset(email);
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">パスワード再設定</h1>

      {submitted ? (
        <p className="mt-6 text-sm text-slate-700">
          登録されているアドレスであれば、再設定のメールをお送りしました。
          メールをご確認ください。
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="forgot-email" className="text-sm font-medium text-slate-700">
              メールアドレス
            </label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? "送信中…" : "再設定メールを送る"}
          </button>
        </form>
      )}

      <p className="mt-6 text-sm text-slate-600">
        <Link href="/login" className="underline">
          ログインに戻る
        </Link>
      </p>
    </main>
  );
}
