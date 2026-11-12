/* Browser tests (npm run test:e2e): the four ways through the app — JSA or
 * JSA + Procedure, drafted by the built-in or an outside AI — plus the JSA
 * editor's sub-steps and the PDF/Word builds, at desktop and phone width.
 *
 * The AI is never called: every /api request is answered by e2e/helpers.ts,
 * so no backend, API key or network is needed — only Vite, started below.
 * First time on a machine: npx playwright install chromium */
import { defineConfig, devices } from "@playwright/test";

const PORT = 5174; // not the dev server's 5173, so both can run at once

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Recording every test costs a lot of time; turn on to debug a failure:
    // npm run test:e2e -- --trace on
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
