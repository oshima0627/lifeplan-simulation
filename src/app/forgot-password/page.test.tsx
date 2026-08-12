// @vitest-environment jsdom
//
// `@/lib/auth/client` の requestPasswordReset をモックする。実際の通信を
// しないため（挙動そのものは src/lib/auth/client.test.ts で検証済み）。
//
// ⚠️ ここで固定したい不変条件は「送信後の文言が、アドレスが登録済みか
// どうかで変わらないこと」。requestPasswordReset は元々サーバーの応答を
// 戻り値に反映しない設計（常に void）なので、画面側がそれを分岐材料に
// 使っていないこと・常に同じ文言を出すことを確認する

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./page";

const { requestPasswordReset } = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({ requestPasswordReset }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const FIXED_MESSAGE = "登録されているアドレスであれば、再設定のメールをお送りしました。";

describe("ForgotPasswordPage", () => {
  it("入力したメールアドレスでrequestPasswordResetを呼ぶ", async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "再設定メールを送る" }));

    await vi.waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith("foo@example.com"));
  });

  it("送信後は常に同じ文言を表示する", async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "not-registered@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "再設定メールを送る" }));

    expect(await screen.findByText(FIXED_MESSAGE, { exact: false })).toBeInTheDocument();
  });

  it("送信後はフォームが消え、同じ文言のみが残る（何度も送れないようにする）", async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "foo@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "再設定メールを送る" }));

    await screen.findByText(FIXED_MESSAGE, { exact: false });
    expect(screen.queryByLabelText("メールアドレス")).not.toBeInTheDocument();
  });

  it("ログインへの導線がある", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: "ログインに戻る" })).toHaveAttribute("href", "/login");
  });
});
