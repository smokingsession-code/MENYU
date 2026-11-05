import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import type { Database } from "./database.types";

/**
 * Service-role client: bypasses row-level security. Only for server code
 * that has already checked the caller is allowed (admin actions, diner
 * event ingestion, cron jobs, webhooks). Never expose to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
