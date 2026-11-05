import "server-only";

/** Server-only secrets and settings. Importing this from client code fails the build. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const serverEnv = {
  get supabaseSecretKey(): string {
    return required("SUPABASE_SECRET_KEY");
  },
  get smsHookSecret(): string {
    return required("SUPABASE_AUTH_HOOK_SEND_SMS_SECRET");
  },
  /** "africastalking" in production, "console" in development and tests. */
  get smsProvider(): "africastalking" | "console" {
    const value = process.env.SMS_PROVIDER ?? (process.env.NODE_ENV === "production" ? "africastalking" : "console");
    if (value !== "africastalking" && value !== "console") throw new Error(`Unknown SMS_PROVIDER "${value}"`);
    return value;
  },
  /** Country codes allowed to receive SMS sign-in codes. Default: Uganda only. */
  get smsAllowedCountryCodes(): string[] {
    return (process.env.SMS_ALLOWED_COUNTRY_CODES ?? "256")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  africasTalking: {
    get username(): string {
      return required("AFRICASTALKING_USERNAME");
    },
    get apiKey(): string {
      return required("AFRICASTALKING_API_KEY");
    },
    /** Registered alphanumeric sender ID or short code. Optional. */
    get senderId(): string | undefined {
      return process.env.AFRICASTALKING_SENDER_ID || undefined;
    },
  },
  get cronSecret(): string {
    return required("CRON_SECRET");
  },
};
