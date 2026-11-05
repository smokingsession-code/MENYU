/**
 * Gives a person full admin access (the founder, or a trusted team member).
 *
 *   npm run admin:add -- 0772123456
 *   npm run admin:add -- founder@example.com
 *
 * Uses SUPABASE_SECRET_KEY from .env.local, so point that file at the right
 * project first. Creates the account if it does not exist yet.
 */
import { normalizePhone } from "../src/lib/phone";
import { adminClient, ensureUser } from "./lib";

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run admin:add -- <phone or email>");
  const isEmail = input.includes("@");
  const phone = isEmail ? null : normalizePhone(input);
  if (!isEmail && !phone) throw new Error(`"${input}" is not a valid phone number`);

  const db = adminClient();
  const user = await ensureUser(db, { phone, email: isEmail ? input.toLowerCase() : null });
  const { error } = await db.from("admins").upsert({ user_id: user.id }, { onConflict: "user_id" });
  if (error) throw error;
  console.log(`${input} is now an admin (user ${user.id}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
