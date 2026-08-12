// @vitest-environment jsdom
//
// AuthForm自体の挙動は src/components/auth/AuthForm.test.tsx で検証済み。
// ここではこのページがAuthFormへ正しいmodeを渡すことと、登録・
// パスワード再設定への導線があることだけを確認する

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("@/components/auth/AuthForm", () => ({
  AuthForm: ({ mode }: { mode: string }) => <div data-testid="auth-form">mode:{mode}</div>,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("LoginPage", () => {
  it("AuthFormにmode=loginを渡す", () => {
    render(<LoginPage />);
    expect(screen.getByTestId("auth-form")).toHaveTextContent("mode:login");
  });

  it("新規登録への導線がある", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "新規登録" })).toHaveAttribute("href", "/signup");
  });

  it("パスワード再設定への導線がある", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "パスワードを忘れた方はこちら" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});
