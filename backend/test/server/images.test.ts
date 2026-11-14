// Node-only: the real Docker entry, whose second withSecurityHeaders pass must keep the image CSP, and whose static
// files hold the YASAD logo the tab icon falls back to.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY, IMAGE_CONTENT_SECURITY_POLICY } from "../../src/security";

const ENV = { AUTH_SECRET: "images-test-secret-of-32-characters!!", PUBLIC_URL: "http://localhost" };

let child: ChildProcess | undefined;
let dir: string | undefined;

afterEach(async () => {
  child?.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
  child = dir = undefined;
});

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

describe("image responses on the Docker server", () => {
  it("keep the image CSP through server.ts, while other responses keep the app's, and the tab icon falls back to a served file", async () => {
    dir = await mkdtemp(join(tmpdir(), "yasad-images-"));
    const dbFile = join(dir, "yasad.db");
    const port = await freePort();
    child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      env: {
        ...process.env,
        ...ENV,
        PORT: String(port),
        DATABASE_URL: `file:${dbFile}`,
        CATALOG_FILE: "",
        SETUP_CODE: "",
        STATIC_DIR: fileURLToPath(new URL("../../../frontend/public", import.meta.url)),
      },
    });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      if (child.exitCode !== null || i === 100) throw new Error(`server did not answer:\n${output}`);
      try {
        if ((await fetch(`${url}/api/health`)).ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const id = "0123456789abcdef0123456789abcdef";
    // The running server may hold the write lock: wait for it rather than fail on it.
    const db = new DatabaseSync(dbFile, { timeout: 5000 });
    try {
      db.prepare("insert into image (id, sha256, type, width, height, size, bytes) values (?, ?, 'image/svg+xml', 1, 1, ?, ?)").run(
        id,
        "f".repeat(64),
        5,
        new TextEncoder().encode("<svg/>"),
      );
    } finally {
      db.close();
    }

    const image = await fetch(`${url}/api/images/${id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/svg+xml");
    expect(image.headers.get("content-security-policy")).toBe(IMAGE_CONTENT_SECURITY_POLICY);
    const missing = await fetch(`${url}/api/images/${"0".repeat(32)}`);
    expect(missing.headers.get("content-security-policy")).toBe(IMAGE_CONTENT_SECURITY_POLICY);
    expect((await fetch(`${url}/api/instance`)).headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);

    const icon = await fetch(`${url}/api/instance/icon`, { redirect: "manual" });
    expect(icon.status).toBe(302);
    expect(icon.headers.get("location")).toBe("/favicon.svg");
    const favicon = await fetch(`${url}/favicon.svg`);
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toContain("image/svg+xml");
    expect(await favicon.text()).toContain("<svg");
  }, 20_000);
});
