import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { SITE_SETTINGS_TAG } from "@/lib/site-settings";
import type { Database } from "@/lib/supabase/database.types";

export interface TopPlace {
  name: string;
  slug: string;
  area: string | null;
}

/**
 * "Top in {area} this week": places ranked by menu visitors and orders on
 * the menu in the last 7 days (see directory_top). The same for everyone,
 * so it is cached for an hour; switching the directory off clears it.
 */
export async function getDirectoryTop(area: string | null): Promise<TopPlace[]> {
  "use cache";
  cacheTag("directory-top", SITE_SETTINGS_TAG);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });

  const supabase = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("directory_top", { p_area: area || undefined, p_limit: 5 });
  if (error) {
    // A ranking is a nice extra: never break the directory over it.
    console.error("[directory] directory_top failed", { message: error.message });
    return [];
  }
  return (data as unknown as TopPlace[] | null) ?? [];
}
