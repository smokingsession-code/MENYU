import type { SmsProvider, SmsResult } from "./types";

/**
 * Africa's Talking SMS. Direct routes to MTN and Airtel Uganda.
 * Docs: https://developers.africastalking.com/docs/sms/sending
 * The "sandbox" username sends to the Africa's Talking simulator instead.
 */
export function createAfricasTalkingProvider(options: {
  username: string;
  apiKey: string;
  senderId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): SmsProvider {
  const { username, apiKey, senderId, fetchImpl = fetch, timeoutMs = 8000 } = options;
  const endpoint =
    username === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

  return {
    name: "africastalking",
    async send(to, message): Promise<SmsResult> {
      const body = new URLSearchParams({ username, to: `+${to}`, message });
      if (senderId) body.set("from", senderId);

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            apiKey,
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return { ok: false, error: `network: ${(error as Error).message}`, retryable: true };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, error: `http ${response.status}: ${text.slice(0, 200)}`, retryable: response.status >= 500 };
      }

      const data = (await response.json().catch(() => null)) as AfricasTalkingResponse | null;
      return interpretAfricasTalkingResponse(data);
    },
  };
}

interface AfricasTalkingResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: { statusCode: number; number: string; status: string; cost?: string; messageId?: string }[];
  };
}

// 100 Processed, 101 Sent, 102 Queued. Everything else is a failure; 5xx
// codes and 405 (insufficient balance, fixable) are worth retrying later.
const SUCCESS_CODES = new Set([100, 101, 102]);
const RETRYABLE_CODES = new Set([405, 500, 501, 502]);

export function interpretAfricasTalkingResponse(data: AfricasTalkingResponse | null): SmsResult {
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  if (!recipient) {
    return { ok: false, error: data?.SMSMessageData?.Message ?? "no recipients in response", retryable: false };
  }
  if (SUCCESS_CODES.has(recipient.statusCode)) {
    return { ok: true, messageId: recipient.messageId, cost: recipient.cost };
  }
  return {
    ok: false,
    error: `${recipient.statusCode} ${recipient.status}`,
    retryable: RETRYABLE_CODES.has(recipient.statusCode),
  };
}
