import { readFileSync, existsSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

/** Chrome DevTools network presets. */
export const NETWORK = {
  fast3g: { offline: false, latency: 563, downloadThroughput: (1474 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 },
  slow3g: { offline: false, latency: 2000, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
} as const;

export async function throttle(page: Page, profile: keyof typeof NETWORK = "fast3g") {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK[profile]);
  return cdp;
}

/** Every page in these tests is throttled to 3G. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await throttle(page, "fast3g");
    await provide(page);
  },
});

export { expect };

const OUTBOX = ".data/dev-sms.jsonl";

/** Reads the sign-in code the console SMS provider wrote for this number. */
export async function smsCode(phone: string, sinceMs: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(OUTBOX)) {
      const lines = readFileSync(OUTBOX, "utf8").trim().split("\n").reverse();
      for (const line of lines) {
        const msg = JSON.parse(line) as { to: string; message: string; at: string };
        if (msg.to === phone && Date.parse(msg.at) >= sinceMs - 1000) {
          const code = msg.message.match(/code is (\d{6})/)?.[1];
          if (code) return code;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No SMS code for ${phone}`);
}

/** Reads the newest sign-in code emailed to `email` from Mailpit. */
export async function emailCode(email: string, sinceMs: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const list = (await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
      messages?: { ID: string; Created: string }[];
    };
    const latest = list.messages?.find((m) => Date.parse(m.Created) >= sinceMs - 1000);
    if (latest) {
      const msg = (await (await fetch(`http://127.0.0.1:54324/api/v1/message/${latest.ID}`)).json()) as { Text: string };
      const code = msg.Text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email code for ${email}`);
}

export function randomUgPhone(): { digits: string; local: string } {
  const rest = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const digits = `25677${rest}`;
  return { digits, local: `077${rest}` };
}

/** Fails if the page scrolls sideways on a 360px screen. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not scroll sideways at 360px").toBeLessThanOrEqual(0);
}

export async function signInWithPhone(page: Page, digits: string, local: string) {
  await page.getByLabel("Phone number").fill(local);
  const since = Date.now();
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  const code = await smsCode(digits, since);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Wait until the session cookie is set and we have left the sign-in page.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}
