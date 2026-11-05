import "server-only";
import { serverEnv } from "@/lib/server-env";
import { createAfricasTalkingProvider } from "./africastalking";
import { createConsoleProvider } from "./console";
import type { SmsProvider } from "./types";

export type { SmsProvider, SmsResult } from "./types";

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  if (serverEnv.smsProvider === "africastalking") {
    const at = serverEnv.africasTalking;
    cached = createAfricasTalkingProvider({ username: at.username, apiKey: at.apiKey, senderId: at.senderId });
  } else {
    cached = createConsoleProvider();
  }
  return cached;
}
