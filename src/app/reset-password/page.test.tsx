// @vitest-environment jsdom
//
// `next/navigation` の useSearchParams と `@/lib/auth/client` の
// fetchResetTokenEmail / resetPassword をモックする（実際の通信をしない
// ため。client.ts 自体の挙動は client.test.ts で検証済み）。
//
// ここで固定したい不変条件は task-4-brief.md の2点:
// 1. token はURLから読み取った後に history.replaceState で消す
//    （消してから読むと壊れるので、読み取りが先に完了していることを確認する）
// 2. 画面は利用者にメールアドレスを入力させない
//    （fetchResetTokenEmailで引いた値をそのままresetPasswordへ渡す）

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

const { fetchResetTokenEmail, resetPassword } = vi.hoisted(() => ({
  fetchResetTokenEmail: vi.fn(),
  resetPassword: vi.fn(),
}));

let mockSearchParams = new URLSearchParams();

vi.mock("@/lib/auth/client", () => ({ fetchResetTokenEmail, resetPassword }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  mockSearchParams = new URLSearchParams({ token: "abc123" });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ResetPasswordPage", () => {
  it("URLのtokenでfetchResetTokenEmailを呼ぶ", async () => {
    fetchResetTokenEmail.mockResolvedValue("foo@example.com");
    render(<ResetPasswordPage />);
    await vi.waitFor(() => expect(fetchResetTokenEmail).toHaveBeenCalledWith("abc123"));
  });

  it("tokenをURLから消す（history.replaceStateを使う）", () => {
    fetchResetTokenEmail.mockReturnValue(new Promise(() => {}));
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<ResetPasswordPage />);

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceStateSpy.mock.calls[0];
    expect(String(url)).not.toContain("token");
  });

  it("消す前にtokenを読み取っている（読み取り→消去の順序）", async () => {
    fetchResetTokenEmail.mockResolvedValue("foo@example.com");
    render(<ResetPasswordPage />);

    // history.replaceState で検索パラメータを消した後でも、
    // fetchResetTokenEmail には元のtoken値が渡っていること
    await vi.waitFor(() => expect(fetchResetTokenEmail).toHaveBeenCalledWith("abc123"));
    expect(window.location.search).not.toContain("token");
  });

  it("利用者にメールアドレスを入力させない。サーバーから引いた値を表示し、そのままresetPasswordへ渡す", async () => {
    fetchResetTokenEmail.mockResolvedValue("foo@example.com");
    resetPassword.mockResolvedValue({ ok: true });
    render(<ResetPasswordPage />);

    expect(await screen.findByText(/foo@example\.com/)).toBeInTheDocument();
    // メールアドレスの入力欄自体が存在しないこと
    expect(screen.queryByLabelText(/メールアドレス/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新しいパスワード"), {
      target: { value: "new password 123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "パスワードを再設定する" }));

    await vi.waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        token: "abc123",
        email: "foo@example.com",
        password: "new password 123",
      }),
    );
  });

  it("再設定に成功したらログインへの導線を出す", async () => {
    fetchResetTokenEmail.mockResolvedValue("foo@example.com");
    resetPassword.mockResolvedValue({ ok: true });
    render(<ResetPasswordPage />);

    fireEvent.change(await screen.findByLabelText("新しいパスワード"), {
      target: { value: "new password 123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "パスワードを再設定する" }));

    expect(await screen.findByRole("link", { name: "ログインへ" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("トークンが無効な場合、再設定をやり直す導線を出す", async () => {
    fetchResetTokenEmail.mockResolvedValue(null);
    render(<ResetPasswordPage />);

    expect(
      await screen.findByText("このリンクは無効か、有効期限が切れています。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "パスワード再設定をやり直す" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("URLにtokenが無い場合も、再設定をやり直す導線を出す（fetchResetTokenEmailは呼ばない）", async () => {
    mockSearchParams = new URLSearchParams();
    render(<ResetPasswordPage />);

    expect(
      await screen.findByText("このリンクは無効か、有効期限が切れています。"),
    ).toBeInTheDocument();
    expect(fetchResetTokenEmail).not.toHaveBeenCalled();
  });

  it("送信時にエラーになったら、サーバーの文言をそのまま表示する", async () => {
    fetchResetTokenEmail.mockResolvedValue("foo@example.com");
    resetPassword.mockResolvedValue({
      ok: false,
      code: "RESET_TOKEN_INVALID",
      message: "このリンクは無効か、有効期限が切れています。再度パスワード再設定をお試しください",
    });
    render(<ResetPasswordPage />);

    fireEvent.change(await screen.findByLabelText("新しいパスワード"), {
      target: { value: "new password 123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "パスワードを再設定する" }));

    expect(
      await screen.findByText(
        "このリンクは無効か、有効期限が切れています。再度パスワード再設定をお試しください",
      ),
    ).toBeInTheDocument();
  });
});
