// Node only: chained batches of the Docker target, on an in-memory libSQL database.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { DOCKER_BUDGET, type RunBudget } from "../../src/checks/budget";
import { runChecks } from "../../src/checks/run";
import type { StatusCheckConfig } from "../../src/config";
import type { DB } from "../../src/db";
import { fetchOutbound } from "../../src/net/fetch-outbound";
import * as schema from "../../src/schema";
import { type FakeNet, fakeNet, type SiteAnswer, targetRequests } from "../harness/fake-net";

const NOW = Date.UTC(2030, 0, 1);
const PUBLIC_A = "93.184.215.14";
const CONFIG: StatusCheckConfig = { intervalMinutes: 5, timeoutSeconds: 10, batch: 2, concurrency: 4 };

let net: FakeNet;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  net = fakeNet();
  vi.stubGlobal("fetch", net.fetch);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  expect(net.unexpected).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A fresh database with one category and `links`, each answering at https://<id>.example. */
async function setup(links: { id: string; answer: SiteAnswer }[]) {
  const libsql = createClient({ url: ":memory:" });
  const db = drizzle(libsql, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await libsql.execute(`insert into category (id, title, position) values ('tools', 'Tools', 0)`);
  for (const [position, { id, answer }] of links.entries()) {
    net.dns[`${id}.example`] = { a: [PUBLIC_A] };
    net.sites[`https://${id}.example`] = answer;
    await libsql.execute(
      `insert into link (id, category_id, title, url, position, check_enabled, active)
       values ('${id}', 'tools', '${id}', 'https://${id}.example/', ${position}, 1, 1)`,
    );
  }
  const rows = async () =>
    (await libsql.execute("select link_id, state, checked_at, claim_id, claimed_until from link_status order by link_id")).rows.map(
      (row) => ({ ...row }),
    );
  const run = (budget: RunBudget, config = CONFIG) =>
    runChecks({ db: db as unknown as DB, config, outbound: () => fetchOutbound({ fetch: net.fetch }), now: NOW, budget });
  return { run, rows };
}

const five = ["a", "b", "c", "d", "e"].map((id) => ({ id, answer: 200 as SiteAnswer }));

describe("chained batches", () => {
  it("chains batches until every due link is checked", async () => {
    const { run, rows } = await setup(five);
    const summary = await run(DOCKER_BUDGET);
    expect(summary).toEqual({ batches: 3, claimed: 5, written: 5, released: 0 });
    const written = await rows();
    expect(written).toHaveLength(5);
    for (const row of written) {
      expect(row.state).toBe("up");
      expect(Number(row.checked_at)).toBeGreaterThanOrEqual(NOW);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("runs one batch when the budget leaves no time to chain", async () => {
    const { run, rows } = await setup(five);
    expect(await run({ runMs: 0, subrequests: null })).toEqual({ batches: 1, claimed: 2, written: 2, released: 0 });
    expect(await rows()).toHaveLength(2);
    // One batch is what this budget asks for: nothing to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it("times a chained batch's results after the batches before it", { timeout: 10_000 }, async () => {
    const { run, rows } = await setup([
      { id: "a", answer: "hang" },
      { id: "b", answer: 200 },
    ]);
    const summary = await run(DOCKER_BUDGET, { ...CONFIG, batch: 1, timeoutSeconds: 2 });
    expect(summary).toMatchObject({ claimed: 2, written: 2, released: 0 });
    // b goes out in the second batch, after a's 2 s timeout.
    const b = (await rows()).find((row) => row.link_id === "b");
    expect(Number(b?.checked_at)).toBeGreaterThanOrEqual(NOW + 2000);
  });

  it("stops chaining once a batch released a link", async () => {
    const { run, rows } = await setup([
      { id: "a", answer: "platform" },
      { id: "b", answer: 200 },
      { id: "c", answer: 200 },
    ]);
    const summary = await run(DOCKER_BUDGET, { ...CONFIG, batch: 1 });
    expect(summary).toEqual({ batches: 1, claimed: 1, written: 0, released: 1 });
    expect(targetRequests(net, "https://a.example")).toHaveLength(1);
    expect(targetRequests(net, "https://b.example")).toHaveLength(0);
    expect(await rows()).toEqual([{ link_id: "a", state: null, checked_at: null, claim_id: null, claimed_until: 0 }]);
  });

  it("warns when a run runs out of time with a full last batch", async () => {
    const { run } = await setup(five);
    // One batch of 2 lasts up to 10 s: a 10 s run has no time left for a second one.
    expect(await run({ runMs: 10_000, subrequests: null })).toMatchObject({ batches: 1, written: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Status checks: a run stopped");
  });

  it("does not warn when the run is out of time but no link is still due", async () => {
    const { run } = await setup(five.slice(0, 2));
    // One batch of 2 lasts up to 10 s and checks every link: nothing is left for a second one.
    expect(await run({ runMs: 10_000, subrequests: null })).toEqual({ batches: 1, claimed: 2, written: 2, released: 0 });
    expect(warn).not.toHaveBeenCalled();
  });
});
