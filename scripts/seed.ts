/**
 * Local development seed: an admin account (and, from phase 2, the Kijani
 * Café demo menu). Refuses to run against a non-local database unless
 * SEED_ALLOW_REMOTE=1.
 *
 * Sign in locally as the admin with phone 0700 000 001 (the code is printed
 * in the Next.js terminal) or email admin@menyu.test (code in Mailpit at
 * http://127.0.0.1:54324).
 */
import { adminClient, ensureUser, isLocalUrl } from "./lib";

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? "256700000001";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@menyu.test";

async function main() {
  if (!isLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 if you really mean it.");
  }
  const db = adminClient();

  const admin = await ensureUser(db, { phone: ADMIN_PHONE, email: ADMIN_EMAIL, fullName: "Menyu Admin" });
  const { error } = await db.from("admins").upsert({ user_id: admin.id }, { onConflict: "user_id" });
  if (error) throw error;
  console.log(`Admin ready: +${ADMIN_PHONE} / ${ADMIN_EMAIL}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
