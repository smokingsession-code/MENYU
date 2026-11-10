import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Integration tests talk to the local Supabase stack (npm run db:start).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1")) {
  throw new Error("Integration tests only run against the local Supabase stack.");
}

// Every feature switch on (Admin > Features): these tests exercise every
// feature. tests/integration/feature-switches.test.ts covers the switches.
execFileSync("psql", [process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-qc", "update public.feature_flags set enabled = true; delete from public.restaurant_features;"]);
