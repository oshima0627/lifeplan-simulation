"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { fetchResetTokenEmail, resetPassword } from "@/lib/auth/client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/kdf";

type Status = "loading" | "invalid" | "ready";

/**
 * URLの `token` を読んで新しいパスワードを設定する画面の中身。
 *
 * ⚠️ `useSearchParams` を使うコンポーネントは、静的エクスポート
 * （output: "export"）では呼び出し元で Suspense 境界に包む必要がある
 * （包まないと `next build` が失敗する）。包む役目はデフォルトエクスポートの
 * `ResetPasswordPage` 側が持つ。
 *
 * ⚠️ 鍵導出にはメールアドレスが要る（ソルトがメール由来。src/lib/auth/kdf.ts
 * の saltFor）。この画面はトークンしか持たないため、利用者に入力させず
 * `fetchResetTokenEmail(token)` でサーバーから引く。入力させると打ち間違いで
 * 「再設定は成功したのにログインできない」という原因不明の状態になる
 * （task-4-brief.md）。
 */
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  // ⚠️ 順序が肝心: token はこの useState の初期化子で「初回レンダー時点」に
  // 一度だけ読み取る。読み取りは以降の history.replaceState（下の
  // useEffect）より必ず先に走る（初期化子はレンダー中、replaceStateは
  // レンダー後のeffect内のため）。先に消してから読もうとすると token が
  // 取れなくなる（task-4-brief.md）。
  const [token] = useState(() => searchParams.get("token"));

  // token が無い場合は「無効」であることがこの時点（レンダー中）で確定して
  // いるので、初期値として直接反映する。effect内で同期的にsetStateすると
  // react-hooks の set-state-in-effect ルールに引っかかる（無駄な
  // カスケードレンダーになるため）ので避ける
  const [status, setStatus] = useState<Status>(() => (token ? "loading" : "invalid"));
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // トークンをURLから消す。Referer やブラウザ履歴に残ると漏れるため
  // （設計書 §11.1、task-4-brief.md）。token は上で既に読み取り済みなので、
  // ここでは history.replaceState でクエリを落とすだけでよい。
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchResetTokenEmail(token).then((resolvedEmail) => {
      if (cancelled) return;
      if (!resolvedEmail) {
        setStatus("invalid");
        return;
      }
      setEmail(resolvedEmail);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordOutOfRange =
    password.length > 0 &&
    (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !token || !email) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await resetPassword({ token, email, password });
      if (result.ok) {
        setDone(true);
        return;
      }
      setError(result.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <p className="mt-6 text-sm text-slate-600">確認しています…</p>;
  }

  if (status === "invalid") {
    return (
      <div className="mt-6 flex flex-col gap-3 text-sm text-slate-700">
        <p role="alert">このリンクは無効か、有効期限が切れています。</p>
        <Link href="/forgot-password" className="w-fit underline">
          パスワード再設定をやり直す
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mt-6 flex flex-col gap-3 text-sm text-slate-700">
        <p>パスワードを再設定しました。新しいパスワードでログインしてください。</p>
        <Link href="/login" className="w-fit underline">
          ログインへ
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <p className="text-sm text-slate-600">対象のメールアドレス: {email}</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="reset-password-input" className="text-sm font-medium text-slate-700">
          新しいパスワード
        </label>
        <input
          id="reset-password-input"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
        {passwordOutOfRange && (
          <p className="text-xs text-amber-600">
            パスワードは{PASSWORD_MIN_LENGTH}〜{PASSWORD_MAX_LENGTH}文字を推奨します
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? "処理中…" : "パスワードを再設定する"}
      </button>

      {/* トークンが途中で失効した場合（送信時に RESET_TOKEN_INVALID 等）にも
          やり直せるよう、常時この導線を出しておく */}
      <Link href="/forgot-password" className="w-fit text-sm underline">
        リンクが無効な場合は再設定をやり直す
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">新しいパスワードの設定</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-slate-600">読み込み中…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
