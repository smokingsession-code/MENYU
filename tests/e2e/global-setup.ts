import { execFileSync } from "node:child_process";

/**
 * Each run signs in as the seeded admin several times; clear the local
 * rate-limit counters so earlier runs in the same hour do not lock it out.
 * Local database only.
 */
export default function globalSetup() {
  const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("e2e tests only run against the local database");
  execFileSync("psql", [url, "-qc", "delete from public.rate_limits"], { stdio: "inherit" });
}
