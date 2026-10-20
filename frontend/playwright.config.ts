import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3199);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const E2E_DB = "e2e/.data/yasad.db";
export const SETUP_CODE = "e2e-setup-code-0123456789abcdef";

const OIDC_PORT = Number(process.env.E2E_OIDC_PORT ?? 3198);
export const OIDC_BASE_URL = `http://127.0.0.1:${OIDC_PORT}`;
// Outside e2e/.data, which the first server empties while this one starts.
export const OIDC_E2E_DB = join(tmpdir(), "yasad-e2e-oidc", "yasad.db");
const FAKE_OIDC_PORT = Number(process.env.E2E_FAKE_OIDC_PORT ?? 3197);
export const FAKE_OIDC_URL = `http://127.0.0.1:${FAKE_OIDC_PORT}`;
// Long on purpose: the 320 px reflow checks then cover a provider button whose label must wrap.
export const OIDC_PROVIDER_NAME = "Contoso Microsoft Entra ID";
export const OIDC_CLIENT = { id: "yasad-e2e", secret: "e2e-fake-client-secret" };

// One server on a fresh database, shared by every test: they run one after the other. The setup project creates
// the administrator; the others start from there. The oidc project runs against a second server, signing in through
// the fake identity provider served next to it.
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
    { name: "account", testMatch: "account.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    { name: "admin", testMatch: "admin.spec.ts", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    // After shell, which imports the home fixture; the spec imports it again so it does not rely on that order alone.
    { name: "pins", testMatch: "pins.spec.ts", dependencies: ["shell"], use: { ...devices["Desktop Chrome"] } },
    // A second instance, signing in only through the fake provider: no setup code, password sign-in off.
    { name: "oidc", testMatch: "oidc.spec.ts", use: { ...devices["Desktop Chrome"], baseURL: OIDC_BASE_URL } },
  ],
  webServer: [
    {
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
    {
      command: `rm -rf "${join(OIDC_E2E_DB, "..")}" && node --import tsx ../backend/src/server.ts`,
      url: `${OIDC_BASE_URL}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(OIDC_PORT),
        PUBLIC_URL: OIDC_BASE_URL,
        AUTH_SECRET: "e2e-oidc-secret-that-is-at-least-32-characters",
        DATABASE_URL: `file:${OIDC_E2E_DB}`,
        MIGRATIONS_DIR: "../backend/drizzle",
        STATIC_DIR: "dist",
        CATALOG_FILE: "e2e/fixtures/oidc.yaml",
        PASSWORD_SIGN_IN: "false",
        OIDC_DISCOVERY_URL: `${FAKE_OIDC_URL}/.well-known/openid-configuration`,
        OIDC_CLIENT_ID: OIDC_CLIENT.id,
        OIDC_CLIENT_SECRET: OIDC_CLIENT.secret,
        OIDC_PROVIDER_NAME,
        OIDC_ALLOWED_GROUPS: "portal-users",
        OIDC_ADMIN_GROUPS: "portal-admins",
      },
    },
    {
      command: "node --import tsx e2e/fake-oidc-server.ts",
      url: `${FAKE_OIDC_URL}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      env: { FAKE_OIDC_ISSUER: FAKE_OIDC_URL, FAKE_OIDC_CLIENT_ID: OIDC_CLIENT.id, FAKE_OIDC_CLIENT_SECRET: OIDC_CLIENT.secret },
    },
  ],
});
