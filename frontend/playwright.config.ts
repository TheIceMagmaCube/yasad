import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3199);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const E2E_DB = "e2e/.data/yasad.db";
export const SETUP_CODE = "e2e-setup-code-0123456789abcdef";

// One server on a fresh database, shared by every test: they run one after the other. The setup project creates
// the administrator; the others start from there.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: "setup.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "shell", testMatch: "shell.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    { name: "forms", testMatch: "forms.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `rm -rf e2e/.data && node --import tsx ../backend/src/server.ts`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      PUBLIC_URL: BASE_URL,
      AUTH_SECRET: "e2e-secret-that-is-at-least-32-characters",
      SETUP_CODE,
      DATABASE_URL: `file:${E2E_DB}`,
      MIGRATIONS_DIR: "../backend/drizzle",
      STATIC_DIR: "dist",
    },
  },
});
