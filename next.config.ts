import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 全ページSSGのため静的エクスポートし、Cloudflare Workers (Static Assets) で配信する
  output: "export",
};

export default nextConfig;
