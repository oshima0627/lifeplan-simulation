// @vitest-environment jsdom
//
// マウント後の fetchMe 呼び出しと表示切り替えを検証するので jsdom が要る。
// `@/lib/auth/client` はモックする（実際の通信をしないため。挙動そのものは
// src/lib/auth/client.test.ts で検証済み）。作法は AccountNav.test.tsx に合わせた

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountPage from "./page";

const { fetchMe, logout } = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({ fetchMe, logout }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("AccountPage", () => {
  it("初回描画（fetchMe解決前）は確認中の表示になる（静的エクスポートのHTMLと一致させるため）", () => {
    fetchMe.mockReturnValue(new Promise(() => {})); // 解決させない
    render(<AccountPage />);
    expect(screen.getByText("確認しています…")).toBeInTheDocument();
  });

  it("未ログインならログインへ促す", async () => {
    fetchMe.mockResolvedValue(null);
    render(<AccountPage />);
    expect(await screen.findByText("ログインしていません。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/login");
  });

  it("ログイン済みならログイン状態とログアウトボタンを表示する", async () => {
    fetchMe.mockResolvedValue("user-1");
    render(<AccountPage />);
    expect(await screen.findByText("ログインしています。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("ログアウトボタンを押すとlogoutを呼び、未ログイン表示に戻る", async () => {
    fetchMe.mockResolvedValue("user-1");
    logout.mockResolvedValue(undefined);
    render(<AccountPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("ログインしていません。")).toBeInTheDocument();
  });
});
