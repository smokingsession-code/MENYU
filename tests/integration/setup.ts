import { existsSync } from "node:fs";

// Integration tests talk to the local Supabase stack (npm run db:start).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1")) {
  throw new Error("Integration tests only run against the local Supabase stack.");
}
