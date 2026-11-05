import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SmsProvider } from "./types";

/**
 * Development provider: prints the SMS and appends it to .data/dev-sms.jsonl
 * so local sign-in and end-to-end tests work without sending real messages.
 * Refuses to run in production.
 */
export function createConsoleProvider(outbox = path.join(process.cwd(), ".data", "dev-sms.jsonl")): SmsProvider {
  return {
    name: "console",
    async send(to, message) {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_CONSOLE_SMS !== "1") {
        return { ok: false, error: "console SMS provider is disabled in production", retryable: false };
      }
      console.info(`[sms] to +${to}: ${message}`);
      await mkdir(path.dirname(outbox), { recursive: true });
      await appendFile(outbox, JSON.stringify({ to, message, at: new Date().toISOString() }) + "\n");
      return { ok: true, messageId: `console-${Date.now()}` };
    },
  };
}
