// Deploys the Worker with the version of the checkout, as the Docker image gets it at build time.
// Usage, from backend/: npm run deploy:worker [-- <wrangler deploy arguments>]
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Return the app version for a `git describe --tags --always` output, without the leading v; "dev" when null or empty. */
export function versionOf(describe) {
  const trimmed = (describe ?? "").trim();
  if (trimmed === "") return "dev";
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

/** Return the arguments of wrangler: deploy, the version define (JSON-quoted), then the caller's arguments. */
export function deployArgs(version, extra) {
  return ["deploy", "--define", `__APP_VERSION__:${JSON.stringify(version)}`, ...extra];
}

function describeCheckout() {
  try {
    return execFileSync("git", ["describe", "--tags", "--always"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = versionOf(describeCheckout());
  console.log(`Deploying YASAD ${version}`);
  // No shell: the arguments reach wrangler as they are.
  const result = spawnSync("wrangler", deployArgs(version, process.argv.slice(2)), { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
