// Node-only: starts the real Docker entry (src/server.ts) as a child process.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess, logs: () => string): Promise<Response> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}:\n${logs()}`);
    try {
      return await fetch(url);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server did not answer:\n${logs()}`);
}

describe("server startup", () => {
  let child: ChildProcess | undefined;
  let tmp: string | undefined;

  afterEach(async () => {
    child?.kill();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("creates the directory of a file: database that does not exist yet", async () => {
    tmp = await mkdtemp(join(tmpdir(), "yasad-"));
    const dbFile = join(tmp, "nested", "dir", "yasad.db");
    const port = await freePort();

    let output = "";
    child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      env: { ...process.env, DATABASE_URL: `file:${dbFile}`, PORT: String(port) },
    });
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));

    const res = await waitForHealth(`http://127.0.0.1:${port}/api/health`, child, () => output);
    expect(res.status).toBe(200);
    expect(existsSync(dbFile)).toBe(true);
  }, 20_000);
});
