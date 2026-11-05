/**
 * Environment access. Public values (NEXT_PUBLIC_*) are inlined into the
 * browser bundle at build time; everything else must only ever be read on
 * the server (see server-env.ts).
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const publicEnv = {
  get siteUrl(): string {
    return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey(): string {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  },
};
