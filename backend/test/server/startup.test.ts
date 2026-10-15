// Node-only: starts the real Docker entry (src/server.ts) as a child process.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SETUP_CODE_STILL_SET } from "../../src/setup-state";

const PUBLIC_URL = "http://localhost";
const SETUP_CODE = "startup-test-setup-code-0123456789";
const BASE_ENV = { AUTH_SECRET: "startup-test-secret-of-32-characters!", PUBLIC_URL };

type Server = { child: ChildProcess; url: string; output: () => string; exited: Promise<number | null> };

const children: ChildProcess[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
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

async function tmpDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "yasad-"));
  tmpDirs.push(dir);
  return join(dir, "nested", "dir", "yasad.db");
}

async function start(env: Record<string, string | undefined>, nodeArgs: string[] = []): Promise<Server> {
  const port = await freePort();
  const childEnv: Record<string, string | undefined> = { ...process.env, PORT: String(port), ...env };
  for (const key of Object.keys(childEnv)) if (childEnv[key] === undefined) delete childEnv[key];
  const child = spawn(process.execPath, [...nodeArgs, "--import", "tsx", "src/server.ts"], { env: childEnv });
  children.push(child);
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { child, url: `http://127.0.0.1:${port}`, output: () => output, exited };
}

async function stop(server: Server): Promise<void> {
  server.child.kill();
  await server.exited;
}

async function waitForHealth(server: Server): Promise<Response> {
  for (let i = 0; i < 100; i++) {
    if (server.child.exitCode !== null) throw new Error(`server exited with ${server.child.exitCode}:\n${server.output()}`);
    try {
      return await fetch(`${server.url}/api/health`);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server did not answer:\n${server.output()}`);
}

describe("server startup", () => {
  it("creates the directory of a file: database that does not exist yet", async () => {
    const dbFile = await tmpDb();
    const server = await start({ ...BASE_ENV, DATABASE_URL: `file:${dbFile}` });
    expect((await waitForHealth(server)).status).toBe(200);
    expect(existsSync(dbFile)).toBe(true);
  }, 20_000);

  it("refuses to start on an invalid configuration", async () => {
    const server = await start({ DATABASE_URL: `file:${await tmpDb()}`, AUTH_SECRET: undefined, PUBLIC_URL: undefined });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain("AUTH_SECRET");
    expect(server.output()).toContain("PUBLIC_URL");
  }, 20_000);

  it("starts from .env.example on a fresh clone", async () => {
    const server = await start(
      { DATABASE_URL: `file:${await tmpDb()}`, AUTH_SECRET: undefined, PUBLIC_URL: undefined, SETUP_CODE: undefined },
      ["--env-file=.env.example"],
    );
    expect((await waitForHealth(server)).status).toBe(200);
  }, 20_000);

  it("keeps sessions across a restart and warns while SETUP_CODE stays set", async () => {
    const env = { ...BASE_ENV, SETUP_CODE, DATABASE_URL: `file:${await tmpDb()}` };
    const first = await start(env);
    await waitForHealth(first);
    expect(first.output()).not.toContain(SETUP_CODE_STILL_SET);
    const setup = await fetch(`${first.url}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PUBLIC_URL },
      body: JSON.stringify({
        code: SETUP_CODE,
        name: "Ada",
        email: "ada@example.org",
        password: "correct horse battery",
        passwordConfirm: "correct horse battery",
      }),
    });
    expect(setup.status).toBe(201);
    const cookie = setup.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    await stop(first);

    const second = await start(env);
    await waitForHealth(second);
    expect(second.output()).toContain(SETUP_CODE_STILL_SET);
    const session = await fetch(`${second.url}/api/auth/get-session`, { headers: { cookie } });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe("ada@example.org");
  }, 30_000);

  it("sends the security headers on the static frontend", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "yasad-static-"));
    tmpDirs.push(staticDir);
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>YASAD</title>");
    const server = await start({ ...BASE_ENV, DATABASE_URL: `file:${await tmpDb()}`, STATIC_DIR: staticDir });
    await waitForHealth(server);
    for (const path of ["/", "/some/client/route"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  }, 20_000);
});
