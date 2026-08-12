// @vitest-environment jsdom
//
// マウント後の fetchMe 呼び出しと表示切り替えを検証するので jsdom が要る。
// 環境指定の作法は src/components/Simulator.test.tsx に合わせている。
// `@/lib/auth/client` はモックする（実際の通信をしないため。client.ts 自体の
// 挙動は src/lib/auth/client.test.ts で検証済み）

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountNav } from "./AccountNav";

const { fetchMe, logout } = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({ fetchMe, logout }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("AccountNav", () => {
  it("初回描画（fetchMe解決前）は未ログイン状態で表示される（静的エクスポートのHTMLと一致させるため）", () => {
    fetchMe.mockReturnValue(new Promise(() => {})); // 解決させない
    render(<AccountNav />);
    expect(screen.getByText("ログイン")).toBeInTheDocument();
    expect(screen.getByText("登録")).toBeInTheDocument();
  });

  it("未ログインならログイン・登録へのリンクを表示する", async () => {
    fetchMe.mockResolvedValue(null);
    render(<AccountNav />);
    expect(await screen.findByText("ログイン")).toBeInTheDocument();
    expect(screen.getByText("登録")).toBeInTheDocument();
    expect(screen.queryByText("ログアウト")).not.toBeInTheDocument();
  });

  it("ログイン済みならアカウントリンクとログアウトボタンを表示する", async () => {
    fetchMe.mockResolvedValue("user-1");
    render(<AccountNav />);
    expect(await screen.findByText("ログアウト")).toBeInTheDocument();
    expect(screen.getByText("アカウント")).toBeInTheDocument();
    expect(screen.queryByText("ログイン")).not.toBeInTheDocument();
  });

  it("ログアウトボタンを押すとlogoutを呼び、未ログイン表示に戻る", async () => {
    fetchMe.mockResolvedValue("user-1");
    logout.mockResolvedValue(undefined);
    render(<AccountNav />);

    fireEvent.click(await screen.findByText("ログアウト"));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("ログイン")).toBeInTheDocument();
  });
});
