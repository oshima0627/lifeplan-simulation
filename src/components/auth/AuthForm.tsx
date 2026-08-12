"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { login, signup } from "@/lib/auth/client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/kdf";
import { TurnstileWidget } from "./Turnstile";

interface AuthFormProps {
  mode: "signup" | "login";
}

/**
 * 新規登録・ログイン共通のフォーム。
 *
 * - signup のときだけ Turnstile を表示し、トークンが無ければ送信できない
 * - 鍵導出（PBKDF2 60万回、0.2〜0.6秒）+ 通信の間は `submitting` で
 *   ローディング表示と送信ボタンの無効化を行う。無反応に見えると
 *   利用者が二重にクリックしてしまうため（task-3-brief.md）
 * - エラーはサーバーの文言をそのまま表示する。言い換えると、login失敗時に
 *   「ユーザーが存在しない」と「パスワード（鍵）が違う」を区別できないよう
 *   揃えてある文言（worker/auth/routes.ts の AUTH_FAILURE_MESSAGE）が崩れる
 */
export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTurnstile = mode === "signup";
  const turnstileMissing = needsTurnstile && turnstileToken === "";
  const disableSubmit = submitting || turnstileMissing;

  // ⚠️ パスワードの長さ検証は「助言」に留まる。deriveClientKey（src/lib/auth/kdf.ts）
  // がパスワードを鍵に変えてから送るため、サーバーには鍵しか届かず元のパスワードの
  // 長さを検証できない。ここで弾いてもブラウザ側の話で、API を直接叩けば
  // 迂回できる。あくまで入力時の目安として表示するだけのもの
  const passwordOutOfRange =
    mode === "signup" &&
    password.length > 0 &&
    (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disableSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "signup"
          ? await signup({ email, password, turnstileToken })
          : await login({ email, password });

      if (result.ok) {
        router.push("/");
        return;
      }
      setError(result.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="auth-email" className="text-sm font-medium text-slate-700">
          メールアドレス
        </label>
        <input
          id="auth-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="auth-password" className="text-sm font-medium text-slate-700">
          パスワード
        </label>
        <input
          id="auth-password"
          name="password"
          type="password"
          required
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
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

      {needsTurnstile && <TurnstileWidget onToken={setTurnstileToken} />}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={disableSubmit}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? "処理中…" : mode === "signup" ? "登録する" : "ログインする"}
      </button>
    </form>
  );
}
