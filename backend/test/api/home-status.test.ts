import { type TestApp, testApp } from "#harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import { catalog, type CategorySpec, join, localUser } from "./home-catalog";
import { addUser, post, signIn } from "./users";

type Status = { state: string; checkedAt: string | null; staleAt: string | null };
type HomeBody = { categories: { links: { id: string; status?: Status }[] }[] };

const MINUTE = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function adminApp(): Promise<TestApp> {
  const app = await testApp();
  await addUser(app, { id: "admin", email: "admin@example.invalid", role: "admin" });
  expect((await signIn(app, "admin@example.invalid")).status).toBe(200);
  return app;
}

/** Import a catalog as the admin page does: preview, then apply with its baseVersion. */
async function load(admin: TestApp, categories: CategorySpec[]) {
  const yaml = catalog(categories);
  const preview = await post(admin, "/api/admin/catalog", { yaml, dryRun: true });
  expect(preview.status).toBe(200);
  const { baseVersion } = (await preview.json()) as { baseVersion: string };
  expect((await post(admin, "/api/admin/catalog", { yaml, dryRun: false, baseVersion })).status).toBe(200);
}

/** Store a check result as the scheduler does, straight in the database; `checkedAt` null is a claimed, unchecked row. */
function storeStatus(app: TestApp, rows: { linkId: string; state: string | null; checkedAt: number | null }[]) {
  return app.batch(
    rows.map(
      ({ linkId, state, checkedAt }) =>
        `insert into link_status (link_id, source, state, reason, http_status, checked_at, due_at)
         values ('${linkId}', 'yasad', ${state === null ? "null" : `'${state}'`}, 'http_error', 502, ${checkedAt ?? "null"}, ${Date.now() + 60 * MINUTE})`,
    ),
  );
}

async function home(app: TestApp) {
  const res = await app.request("/api/home");
  expect(res.status).toBe(200);
  const text = await res.text();
  const links = (JSON.parse(text) as HomeBody).categories.flatMap((cat) => cat.links);
  return { res, text, links, status: Object.fromEntries(links.map((l) => [l.id, l.status])) };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("GET /api/home, link status", () => {
  it("never sends the status, nor the id, of a hidden checked link", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "ops",
        groups: ["local:Ops"],
        links: [
          { id: "grafana", groups: ["local:Ops"], check: true },
          { id: "secretlinkgroup", groups: ["local:Dev"], check: true },
        ],
      },
      { id: "dev", groups: ["local:Dev"], links: [{ id: "secretcatgroup", groups: ["local:Ops"], check: true }] },
    ]);
    const at = Date.now() - MINUTE;
    await storeStatus(admin, ["grafana", "secretlinkgroup", "secretcatgroup"].map((linkId) => ({ linkId, state: "down", checkedAt: at })));

    const nobody = await localUser(admin, "nobody");
    const ops = await localUser(admin, "olga");
    await join(admin, "olga", "Ops");
    for (const [who, app] of [["anonymous", admin.another()], ["no group", nobody]] as const) {
      const { text, links } = await home(app);
      expect(links, who).toEqual([]);
      for (const id of ["grafana", "secretlinkgroup", "secretcatgroup", "down", "http_error", "502"]) expect(text, `${who}: ${id}`).not.toContain(id);
    }

    // Olga holds the category group of one link and the link group of the other, never both.
    const { text, links } = await home(ops);
    expect(links.map((l) => l.id)).toEqual(["grafana"]);
    expect(text).not.toContain("secretlinkgroup");
    expect(text).not.toContain("secretcatgroup");
  });

  it("sends a status only for a checked link, without reason nor HTTP status", async () => {
    const admin = await adminApp();
    await load(admin, [
      {
        id: "tools",
        groups: ["@everyone"],
        links: [
          { id: "up", groups: ["@everyone"], check: true },
          { id: "down", groups: ["@everyone"], check: true },
          { id: "unknown", groups: ["@everyone"], check: true },
          { id: "never", groups: ["@everyone"], check: true },
          { id: "claimed", groups: ["@everyone"], check: true },
          { id: "unchecked", groups: ["@everyone"] },
          { id: "unchecked-with-row", groups: ["@everyone"] },
        ],
      },
    ]);
    const at = Date.now() - 2 * MINUTE;
    await storeStatus(admin, [
      { linkId: "up", state: "up", checkedAt: at },
      { linkId: "down", state: "down", checkedAt: at },
      { linkId: "unknown", state: "unknown", checkedAt: at },
      { linkId: "claimed", state: null, checkedAt: null },
      { linkId: "unchecked-with-row", state: "down", checkedAt: at },
    ]);

    const { res, text, links, status } = await home(admin.another());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const fresh = { checkedAt: iso(at), staleAt: iso(at + 15 * MINUTE) };
    expect(status).toEqual({
      up: { state: "up", ...fresh },
      down: { state: "down", ...fresh },
      unknown: { state: "unknown", ...fresh },
      never: { state: "unknown", checkedAt: null, staleAt: null },
      claimed: { state: "unknown", checkedAt: null, staleAt: null },
      unchecked: undefined,
      "unchecked-with-row": undefined,
    });
    expect(links.filter((l) => l.id.startsWith("unchecked")).map((l) => "status" in l)).toEqual([false, false]);
    expect(text).not.toContain("http_error");
    expect(text).not.toMatch(/reason|httpStatus/);
  });

  it("reads unknown three intervals after the check, keeping the check time", async () => {
    const admin = await testApp({ STATUS_CHECK_INTERVAL_MINUTES: "10" });
    await addUser(admin, { id: "admin", email: "admin@example.invalid", role: "admin" });
    expect((await signIn(admin, "admin@example.invalid")).status).toBe(200);
    await load(admin, [
      {
        id: "tools",
        groups: ["@everyone"],
        links: [
          { id: "recent", groups: ["@everyone"], check: true },
          { id: "old", groups: ["@everyone"], check: true },
        ],
      },
    ]);
    const recent = Date.now() - 25 * MINUTE;
    const old = Date.now() - 35 * MINUTE;
    await storeStatus(admin, [
      { linkId: "recent", state: "up", checkedAt: recent },
      { linkId: "old", state: "up", checkedAt: old },
    ]);

    const { status } = await home(admin.another());
    expect(status).toEqual({
      recent: { state: "up", checkedAt: iso(recent), staleAt: iso(recent + 30 * MINUTE) },
      old: { state: "unknown", checkedAt: iso(old), staleAt: iso(old + 30 * MINUTE) },
    });
  });

  it("only reads stored results: no request leaves the server", async () => {
    const admin = await adminApp();
    await load(admin, [{ id: "tools", groups: ["@everyone"], links: [{ id: "wiki", groups: ["@everyone"], check: true }] }]);
    const fetch = vi.fn(() => Promise.reject(new Error("no outbound request expected")));
    vi.stubGlobal("fetch", fetch);
    const { status } = await home(admin.another());
    expect(status).toEqual({ wiki: { state: "unknown", checkedAt: null, staleAt: null } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
