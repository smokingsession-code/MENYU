import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

export function adminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isLocalUrl(url: string | undefined): boolean {
  return !!url && /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
}

export async function findUser(
  client: SupabaseClient<Database>,
  match: { phone?: string | null; email?: string | null },
): Promise<User | null> {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find(
      (u) => (match.phone && u.phone === match.phone) || (match.email && u.email?.toLowerCase() === match.email.toLowerCase()),
    );
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export async function ensureUser(
  client: SupabaseClient<Database>,
  options: { phone?: string | null; email?: string | null; fullName?: string },
): Promise<User> {
  const existing = await findUser(client, options);
  if (existing) return existing;
  const { data, error } = await client.auth.admin.createUser({
    phone: options.phone ?? undefined,
    email: options.email ?? undefined,
    phone_confirm: Boolean(options.phone),
    email_confirm: Boolean(options.email),
    user_metadata: options.fullName ? { full_name: options.fullName } : undefined,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return data.user;
}
