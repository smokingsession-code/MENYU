export type SmsResult =
  | { ok: true; messageId?: string; cost?: string }
  | { ok: false; error: string; retryable: boolean };

export interface SmsProvider {
  readonly name: string;
  /** `to` is international digits without "+", e.g. 256772123456. */
  send(to: string, message: string): Promise<SmsResult>;
}
