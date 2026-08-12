// @vitest-environment jsdom
//
// フォームの分岐（送信可否・ローディング・エラー表示）を検証するので jsdom が要る。
// 環境指定の作法は src/components/Simulator.test.tsx に合わせている。
//
// `@/lib/auth/client` と `./Turnstile` はモックする。
// - client: signup/login は内部で PBKDF2（0.2〜0.6秒）を実行する重い処理で、
//   ここで検証したいのは AuthForm 自身の分岐（disabled/loading/エラー表示）
//   であって鍵導出そのものではない（それは src/lib/auth/client.test.ts の役割）
// - Turnstile: 外部スクリプトに依存し jsdom では動かない
//   （task-2-brief.md）。task-3-brief.md でもこのテストに限りモックしてよいとされている
// `next/navigation` の useRouter も、実際の Next.js アプリの外（テスト）では
// AppRouterContext が無く呼ぶと例外になるためモックする

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm";

// vi.mock はファイル内の位置に関わらずvitestによって先頭へ巻き上げられるので、
// import 文を上にまとめたままここに書ける
const { login, signup } = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
}));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/auth/client", () => ({ login, signup }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./Turnstile", () => ({
  // 実物の代わりに、テストから直接トークンを注入できるボタンを1つ描画する
  TurnstileWidget: ({ onToken }: { onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken("mock-token")}>
      Turnstile確認する
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("AuthForm", () => {
  it("パスワードを type=password の入力欄で受け取る", () => {
    render(<AuthForm mode="login" />);
    const input = screen.getByLabelText("パスワード");
    expect(input).toHaveAttribute("type", "password");
  });

  it("signupモードではTurnstileのトークンが無いと送信ボタンが無効", () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByRole("button", { name: "登録する" })).toBeDisabled();
  });

  it("signupモードでTurnstileのトークンを受け取ると送信ボタンが有効になる", () => {
    render(<AuthForm mode="signup" />);
    fireEvent.click(screen.getByRole("button", { name: "Turnstile確認する" }));
    expect(screen.getByRole("button", { name: "登録する" })).not.toBeDisabled();
  });

  it("loginモードはTurnstileが無くても送信ボタンが最初から有効", () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByRole("button", { name: "ログインする" })).not.toBeDisabled();
  });

  it("送信中はボタンが無効になり、ローディング表示になる（二重送信防止）", async () => {
    const { promise, resolve } = deferred<{ ok: true }>();
    login.mockReturnValue(promise);

    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログインする" }));

    const button = await screen.findByRole("button", { name: "処理中…" });
    expect(button).toBeDisabled();

    resolve({ ok: true });
  });

  it("エラー時はサーバーの文言をそのまま表示する", async () => {
    login.mockResolvedValue({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "メールアドレスまたはパスワードが違います",
    });

    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "wrong password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログインする" }));

    expect(
      await screen.findByText("メールアドレスまたはパスワードが違います"),
    ).toBeInTheDocument();
    // 言い換えられていないこと（サーバーの文言と完全一致すること）を確認済み
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("成功したらトップページへ遷移する", async () => {
    login.mockResolvedValue({ ok: true });

    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログインする" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("signupモードはメールとパスワードとTurnstileトークンをそのままsignupに渡す", async () => {
    signup.mockResolvedValue({ ok: true });

    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turnstile確認する" }));
    fireEvent.click(screen.getByRole("button", { name: "登録する" }));

    await vi.waitFor(() =>
      expect(signup).toHaveBeenCalledWith({
        email: "foo@example.com",
        password: "correct horse battery",
        turnstileToken: "mock-token",
      }),
    );
  });
});
