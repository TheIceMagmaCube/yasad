import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Docker target: API tests against libSQL. The same files run on D1 via vitest.workers.config.ts.
export default defineConfig({
  resolve: { alias: { "#harness": fileURLToPath(new URL("./test/harness/node.ts", import.meta.url)) } },
  test: { name: "node", include: ["test/api/**/*.test.ts", "test/server/**/*.test.ts"] },
});
