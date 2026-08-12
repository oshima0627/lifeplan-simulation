// @vitest-environment jsdom
//
// AuthForm自体の挙動は src/components/auth/AuthForm.test.tsx で検証済み。
// ここではこのページがAuthFormへ正しいmodeを渡すことと、ログインへの
// 導線があることだけを確認する

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignupPage from "./page";

vi.mock("@/components/auth/AuthForm", () => ({
  AuthForm: ({ mode }: { mode: string }) => <div data-testid="auth-form">mode:{mode}</div>,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SignupPage", () => {
  it("AuthFormにmode=signupを渡す", () => {
    render(<SignupPage />);
    expect(screen.getByTestId("auth-form")).toHaveTextContent("mode:signup");
  });

  it("ログインへの導線がある", () => {
    render(<SignupPage />);
    expect(screen.getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/login");
  });
});
