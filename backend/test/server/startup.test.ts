// Node-only: starts the real Docker entry (src/server.ts) as a child process.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
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

  it("waits for another process that holds the database's write lock instead of failing", async () => {
    const dbFile = await tmpDb();
    const server = await start({ ...BASE_ENV, DATABASE_URL: `file:${dbFile}` });
    await waitForHealth(server);
    const other = new DatabaseSync(dbFile);
    try {
      other.exec("begin immediate");
      // A failed sign-in counts the attempt, a write that has to wait for the lock.
      const pending = fetch(`${server.url}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: PUBLIC_URL },
        body: JSON.stringify({ email: "nobody@example.invalid", password: "wrong password!" }),
      });
      await new Promise((r) => setTimeout(r, 300));
      other.exec("commit");
      expect((await pending).status).toBe(401);
    } finally {
      other.close();
    }
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
        email: "ada@example.invalid",
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
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe("ada@example.invalid");
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

  it("keeps an idle connection open longer than reverse proxies keep theirs", async () => {
    const server = await start({ ...BASE_ENV, DATABASE_URL: `file:${await tmpDb()}` });
    await waitForHealth(server);
    const agent = new http.Agent({ keepAlive: true });
    try {
      // Node announces its keepAliveTimeout in this header; the default, 5 s, reset reused connections.
      const keepAlive = await new Promise<string | string[] | undefined>((resolve, reject) => {
        http
          .get(`${server.url}/api/health`, { agent }, (res) => {
            res.resume();
            resolve(res.headers["keep-alive"]);
          })
          .on("error", reject);
      });
      expect(keepAlive).toBe("timeout=125");
    } finally {
      agent.destroy();
    }
  }, 20_000);

  it("serves icon files as immutable JSON, and a missing one as 404", async () => {
    const staticDir = await mkdtemp(join(tmpdir(), "yasad-static-"));
    tmpDirs.push(staticDir);
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>YASAD</title>");
    await mkdir(join(staticDir, "icons", "abc123", "si"), { recursive: true });
    await writeFile(join(staticDir, "icons", "abc123", "si", "github.json"), '{"path":"M0 0"}');
    const server = await start({ ...BASE_ENV, DATABASE_URL: `file:${await tmpDb()}`, STATIC_DIR: staticDir });
    await waitForHealth(server);
    const icon = await fetch(`${server.url}/icons/abc123/si/github.json`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("application/json");
    expect(icon.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(icon.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await fetch(`${server.url}/icons/abc123/si/missing.json`)).status).toBe(404);
    expect((await fetch(`${server.url}/index.html`)).headers.get("cache-control") ?? "").not.toContain("immutable");
  }, 20_000);

  it("applies CATALOG_FILE on every start, and refuses to start on an invalid one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yasad-catalog-"));
    tmpDirs.push(dir);
    const file = join(dir, "catalog.yaml");
    const dbFile = await tmpDb();
    const db = `file:${dbFile}`;
    await writeFile(file, "version: 1\ncategories:\n  - id: tools\n    title: Tools\n    groups: ['@everyone']\n    links:\n      - id: mail\n        title: Mail\n        url: https://mail.example.org\n        groups: ['@everyone', '@everyone']\n");
    const first = await start({ ...BASE_ENV, DATABASE_URL: db, CATALOG_FILE: file });
    await waitForHealth(first);
    expect(first.output()).toContain("2 added, 0 updated, 0 removed");
    await stop(first);

    const second = await start({ ...BASE_ENV, DATABASE_URL: db, CATALOG_FILE: file });
    await waitForHealth(second);
    expect(second.output()).toContain("0 added, 0 updated, 0 removed");
    await stop(second);

    // One entry, with no actor, for the start that changed the catalog; none for the one that did not.
    const log = new DatabaseSync(dbFile);
    try {
      const rows = log.prepare("select actor_id, action, object_type, details from audit_log").all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor_id: null, action: "import", object_type: "catalog" });
      expect(JSON.parse(rows[0]!.details as string)).toMatchObject({ source: "catalog_file", added: { categories: ["tools"], links: ["mail"] } });
    } finally {
      log.close();
    }

    await writeFile(file, "version: 1\ncategories:\n  - id: Tools\n");
    const third = await start({ ...BASE_ENV, DATABASE_URL: db, CATALOG_FILE: file });
    expect(await third.exited).toBe(1);
    expect(third.output()).toContain("categories[0].id");
  }, 30_000);

  it("checks a checked link at startup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yasad-catalog-"));
    tmpDirs.push(dir);
    const file = join(dir, "catalog.yaml");
    const dbFile = await tmpDb();
    // A private literal is refused before any connection. A public literal on a port nothing answers is contacted by
    // the Node client only (the portable client cannot pin an address): it ends down, whatever the network.
    const entry = (id: string, url: string) =>
      `      - id: ${id}\n        title: ${id}\n        url: ${url}\n        check: true\n        groups: ['@everyone']\n`;
    await writeFile(
      file,
      "version: 1\ncategories:\n  - id: tools\n    title: Tools\n    groups: ['@everyone']\n    links:\n" +
        entry("local", "http://127.0.0.1:8080/") +
        entry("public", "http://8.8.8.8:8081/"),
    );
    const server = await start({
      ...BASE_ENV,
      DATABASE_URL: `file:${dbFile}`,
      CATALOG_FILE: file,
      STATUS_CHECK_TIMEOUT_SECONDS: "2",
    });
    await waitForHealth(server);
    // Well before the first minute has passed: the first run starts with the server.
    let rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 100 && !(rows.length === 2 && rows.every((row) => row.state)); i++) {
      const read = new DatabaseSync(dbFile);
      try {
        rows = read.prepare("select link_id, state, reason from link_status order by link_id").all();
      } finally {
        read.close();
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows[0]).toEqual({ link_id: "local", state: "unknown", reason: "blocked_address" });
    expect(rows[1]).toMatchObject({ link_id: "public", state: "down" });
    expect(["connect_failed", "timeout"]).toContain(rows[1]?.reason);
  }, 20_000);
});
