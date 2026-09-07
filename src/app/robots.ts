import type { MetadataRoute } from "next";
import { NON_INDEXABLE_PATHS, SITE_URL } from "@/lib/site";

/**
 * robots.txt（2026-09-07）。
 *
 * これまで robots.txt が無く、`/robots.txt` は Next の 404 ページ（HTML）を返していた。
 * サイトマップの在り処を伝える先が無かったので、sitemap.ts と対で置く。
 *
 * ログイン系のページはクロールを止める。検索から来ても意味が無く、
 * 互いにほぼ同じ中身なので、サイト全体の評価を薄めるだけになる。
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...NON_INDEXABLE_PATHS],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
