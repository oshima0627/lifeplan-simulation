import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    // Simulator.test.tsx だけは jsdom 環境が要る（DOM操作・localStorage の
    // 実機的な検証のため）。ファイル先頭の `// @vitest-environment jsdom` で
    // その1ファイルだけ上書きするので、ここではデフォルトの node のままでよい
    include: ["src/**/*.test.{ts,tsx}", "worker/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
