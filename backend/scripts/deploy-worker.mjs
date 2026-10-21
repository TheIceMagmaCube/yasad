// Deploys the Worker with the version of the checkout, as the Docker image gets it at build time.
// Usage, from backend/: npm run deploy:worker [-- <wrangler deploy arguments>]
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
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

/** Deploy with the checkout's version and the caller's arguments; return the exit status of wrangler (1 when it did not run). */
export function main(extra) {
  const version = versionOf(describeCheckout());
  console.log(`Deploying YASAD ${version}`);
  // No shell: the arguments reach wrangler as they are (a shell would strip the define's JSON quotes).
  const result = spawnSync("wrangler", deployArgs(version, extra), { stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

/** Whether this file is the script node runs: Node resolves symlinks for the main module, so argv[1] is resolved too. */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) process.exit(main(process.argv.slice(2)));
