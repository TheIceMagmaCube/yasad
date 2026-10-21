// Node-only: runs the real deploy script as a child process, against a fake wrangler on PATH.
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/deploy-worker.mjs", import.meta.url));
const BACKEND = fileURLToPath(new URL("../..", import.meta.url));

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Run the script at `scriptPath` with a fake wrangler that records its arguments and exits 7. */
async function deploy(scriptPath: (dir: string) => Promise<string>) {
  const dir = await mkdtemp(join(tmpdir(), "yasad-deploy-"));
  tmpDirs.push(dir);
  const recorded = join(dir, "args.json");
  const wrangler = join(dir, "wrangler");
  await writeFile(
    wrangler,
    `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`,
  );
  await chmod(wrangler, 0o755);
  const result = spawnSync(process.execPath, [await scriptPath(dir), "--dry-run"], {
    cwd: BACKEND,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
  return { status: result.status, args: JSON.parse(await readFile(recorded, "utf8")) as string[] };
}

describe("deploy-worker script", () => {
  it("runs wrangler with the version define and the caller's arguments, and exits with its status", async () => {
    const { status, args } = await deploy(async () => SCRIPT);
    expect(status).toBe(7);
    expect(args[0]).toBe("deploy");
    expect(args[1]).toBe("--define");
    expect(args[2]).toMatch(/^__APP_VERSION__:"[^"]+"$/);
    expect(args.slice(3)).toEqual(["--dry-run"]);
  });

  it("still deploys when launched through a symlink", async () => {
    const { status, args } = await deploy(async (dir) => {
      const link = join(dir, "deploy-worker.mjs");
      await symlink(SCRIPT, link);
      return link;
    });
    expect(status).toBe(7);
    expect(args.slice(3)).toEqual(["--dry-run"]);
  });
});
