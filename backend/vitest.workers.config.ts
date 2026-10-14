import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Cloudflare target: the same API tests, inside workerd, against a local D1 database.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./drizzle", import.meta.url))) },
      },
    }),
  ],
  resolve: { alias: { "#harness": fileURLToPath(new URL("./test/harness/workers.ts", import.meta.url)) } },
  test: {
    name: "workers",
    // Vitest stores this cache in the workspace root node_modules, which workerd cannot read.
    fsModuleCache: false,
    include: ["test/api/**/*.test.ts"],
    setupFiles: ["./test/harness/apply-d1-migrations.ts"],
  },
}));
