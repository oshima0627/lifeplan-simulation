import type { MetadataRoute } from "next";
import { INDEXABLE_PATHS, SITE_URL } from "@/lib/site";

/**
 * sitemap.xml（2026-09-07）。
 *
 * Search Console に `sc-domain:lifeplan.nexeed-lab.com` のプロパティがあるのに
 * `https://lifeplan.nexeed-lab.com/sitemap.xml` が 404 を返していて、サイトマップを
 * 登録できない状態だった（2026-09-07 に curl で実測）。
 *
 * lastModified は入れない。`output: "export"` ではビルドのたびに値が変わり、
 * 中身が変わっていないページまで「更新された」と伝えてしまうため。
 */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXABLE_PATHS.map((path) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
  }));
}
