import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a production build (npm run build) on a
 * 360px-wide phone viewport with 3G network throttling (see
 * tests/e2e/fixtures.ts). They need the local Supabase stack running.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "en-UG",
    timezoneId: "Africa/Kampala",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // 0.0.0.0 so the Supabase Auth container can reach the SMS hook.
    command: "npx next start -H 0.0.0.0 -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
