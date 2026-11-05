import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import type { PublicMenu } from "./types";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function menuTag(slug: string) {
  return `menu:${slug}`;
}

/**
 * The public menu for a branch slug, cached and shared by every diner.
 * Owner edits expire it at once through its tag (see revalidateMenu); the
 * time-based lifetime is only a safety net for changes made elsewhere.
 */
export async function getPublicMenu(slug: string): Promise<PublicMenu | null> {
  "use cache";
  cacheTag(menuTag(slug));
  cacheLife({ stale: 60, revalidate: 300, expire: 86_400 });

  if (!SLUG_PATTERN.test(slug) || slug.length > 80) return null;
  // No cookies: diners are anonymous, and row-level security only lets the
  // anon role call get_public_menu.
  const supabase = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("get_public_menu", { p_slug: slug });
  if (error) throw new Error(`get_public_menu failed: ${error.message}`);
  return (data as unknown as PublicMenu | null) ?? null;
}
