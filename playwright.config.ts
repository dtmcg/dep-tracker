import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4318);
const GOOGLE_PORT = Number(process.env.E2E_GOOGLE_PORT ?? 4319);
const google = `http://127.0.0.1:${GOOGLE_PORT}`;
// A fresh config folder per run, so Google sign-in starts signed out.
const configDir = path.join(tmpdir(), `dep-tracker-e2e-config-${process.pid}`);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-GB",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --import tsx scripts/fake-google.mts",
      url: `${google}/__admin/tokens`,
      env: { PORT: String(GOOGLE_PORT), GOOGLE_CLIENT_ID: "e2e-client", GOOGLE_CLIENT_SECRET: "e2e-secret" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run start",
      url: `http://127.0.0.1:${PORT}/api/health`,
      env: {
        PORT: String(PORT),
        GOOGLE_CLIENT_ID: "e2e-client",
        GOOGLE_CLIENT_SECRET: "e2e-secret",
        DEP_TRACKER_GOOGLE_ACCOUNTS_URL: google,
        DEP_TRACKER_GOOGLE_OAUTH_URL: google,
        DEP_TRACKER_GOOGLE_SHEETS_URL: google,
        DEP_TRACKER_CONFIG_DIR: configDir,
        DEP_TRACKER_PROJECTS_DIR: path.join(configDir, "pdm_projects"),
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
