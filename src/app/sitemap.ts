import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The home page, the directory and every listed menu (only approved
 * listings are indexable; see the menu page's robots metadata).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = publicEnv.siteUrl;
  const supabase = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, { auth: { persistSession: false } });
  const { data } = await supabase.rpc("directory_search", { p_limit: 200 });
  const result = (data ?? { enabled: false, results: [] }) as unknown as { enabled: boolean; results: { slug: string }[] };
  const pages: MetadataRoute.Sitemap = [{ url: site, changeFrequency: "weekly", priority: 1 }];
  if (result.enabled) {
    pages.push({ url: `${site}/menus`, changeFrequency: "daily", priority: 0.8 });
    for (const r of result.results) pages.push({ url: `${site}/r/${r.slug}`, changeFrequency: "weekly", priority: 0.6 });
  }
  return pages;
}
