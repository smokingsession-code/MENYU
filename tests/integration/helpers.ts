import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

export type Client = SupabaseClient<Database>;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export function serviceClient(): Client {
  return createClient<Database>(url(), process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): Client {
  return createClient<Database>(url(), publishable(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export function uniq(prefix = "t"): string {
  return `${prefix}${randomBytes(4).toString("hex")}`;
}

/** A random Ugandan-looking mobile number in the 0700 range used for tests. */
export function testPhone(): string {
  return `2567${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

export interface TestUser {
  id: string;
  email: string;
  client: Client;
}

/** Creates a confirmed user and returns a client signed in as them. */
export async function signedInUser(options: { email?: string; phone?: string } = {}): Promise<TestUser> {
  const service = serviceClient();
  const email = options.email ?? `${uniq("user")}@menyu.test`;
  const password = `pw-${randomBytes(12).toString("hex")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone: options.phone,
    phone_confirm: Boolean(options.phone),
  });
  if (error || !data.user) throw error ?? new Error("no user");

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

export async function makeAdmin(userId: string) {
  const { error } = await serviceClient().from("admins").upsert({ user_id: userId });
  if (error) throw error;
}

export interface CreatedRestaurant {
  restaurant_id: string;
  branch_id: string;
  menu_id: string;
  slug: string;
  invitation_token: string | null;
}

export async function selfServeRestaurant(owner: TestUser, name = `Cafe ${uniq()}`): Promise<CreatedRestaurant> {
  const { data, error } = await owner.client.rpc("create_restaurant", { p_name: name, p_area: "Ntinda", p_whatsapp: "256772000111" });
  if (error) throw error;
  return data as unknown as CreatedRestaurant;
}

export async function setSubscription(restaurantId: string, values: Partial<Database["public"]["Tables"]["subscriptions"]["Update"]>) {
  const { error } = await serviceClient().from("subscriptions").update(values).eq("restaurant_id", restaurantId);
  if (error) throw error;
}
