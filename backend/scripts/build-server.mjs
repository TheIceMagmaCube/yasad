// Bundles the Docker entry point. APP_VERSION comes from the CI (git tag) and defaults to "dev".
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["@libsql/client"],
  outfile: "dist/server.js",
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "dev") },
  logLevel: "info",
});
