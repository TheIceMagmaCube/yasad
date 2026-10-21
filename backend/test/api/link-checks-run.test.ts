import { type TestApp, testApp, type TestEnv } from "#harness";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { D1_CALLS, fitBatch, WORKERS_BUDGET } from "../../src/checks/budget";
import { DOH_ENDPOINT } from "../../src/net/doh";
import { type DnsEntry, type FakeNet, fakeNet, type SiteAnswer, targetRequests } from "../harness/fake-net";
import { NON_PUBLIC_ADDRESSES, POLICY_CASES } from "../unit/net-cases";
import { adminApp, importFile, type Link, newCategory, newLink } from "./catalog-items";
import { send } from "./users";

const NOW = Date.UTC(2030, 0, 1);
const INTERVAL = 5 * 60_000;
const PUBLIC_A = "93.184.215.14";

let net: FakeNet;
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  net = fakeNet();
  vi.stubGlobal("fetch", net.fetch);
  errors = vi.spyOn(console, "error");
});

afterEach(() => {
  expect(net.unexpected).toEqual([]);
  // A swallowed SQL or binding error must fail the test, not only log.
  expect(errors.mock.calls.filter(([first]) => String(first).startsWith("Status checks failed"))).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Seed = { id: string; url: string; check?: boolean; active?: boolean };

/** Insert a category and its links straight in the database, checked unless said otherwise. */
async function seed(app: TestApp, links: Seed[]) {
  await app.exec(`insert into category (id, title, position) values ('tools', 'Tools', 0)`);
  for (const [position, l] of links.entries()) {
    await app.exec(
      `insert into link (id, category_id, title, url, position, check_enabled, active)
       values ('${l.id}', 'tools', '${l.id}', '${l.url}', ${position}, ${l.check === false ? 0 : 1}, ${l.active === false ? 0 : 1})`,
    );
  }
}

/** A public name answering `answer` at https://<name>. */
function site(name: string, answer: SiteAnswer): string {
  net.dns[name] = { a: [PUBLIC_A] };
  net.sites[`https://${name}`] = answer;
  return `https://${name}/`;
}

const statusRows = (app: TestApp) =>
  app.query(
    "select link_id, state, reason, http_status, checked_at, due_at, claim_id, claimed_until from link_status order by link_id",
  );

/** Longest a check may take in these tests, from the run's time to the end of the check. */
const SLACK = 15_000;

/** A time from `from` to `from + SLACK`: a result is timed at the end of its check, not at the run's time. */
const within = (from: number) => ({
  asymmetricMatch: (value: unknown) => typeof value === "number" && value >= from && value <= from + SLACK,
  toString: () => `a time from ${from} to ${from + SLACK}`,
});

/** A result of a check that ended between `now` and `now + SLACK`, due again one interval later. */
const result = (linkId: string, state: string, reason: string | null, httpStatus: number | null, now = NOW) => ({
  link_id: linkId,
  state,
  reason,
  http_status: httpStatus,
  checked_at: within(now),
  due_at: within(now + INTERVAL),
  claim_id: null,
  claimed_until: 0,
});

async function checkedApp(links: Seed[], env: TestEnv = {}): Promise<TestApp> {
  const app = await testApp(env);
  await seed(app, links);
  return app;
}

describe("scheduled link checks", () => {
  it("never contacts a link that is not checked, or an inactive checked link", async () => {
    const app = await checkedApp([
      { id: "off", url: site("off.example", 200), check: false },
      { id: "asleep", url: site("asleep.example", 200), active: false },
    ]);
    await app.runChecks({ now: NOW });
    expect(net.requests).toEqual([]);
    expect(await statusRows(app)).toEqual([]);
  });

  it("stores up, down and unknown with the time and the next due time", async () => {
    net.dns["nxdomain.example"] = { status: 3 };
    net.dns["inside.example"] = { a: ["10.0.0.5"] };
    const app = await checkedApp([
      { id: "boom", url: site("boom.example", 503) },
      { id: "gone", url: site("gone.example", 404) },
      { id: "inside", url: "https://inside.example/" },
      { id: "nxdomain", url: "https://nxdomain.example/" },
      { id: "up", url: site("up.example", 200) },
    ]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([
      result("boom", "down", "http_error", 503),
      result("gone", "down", "http_error", 404),
      result("inside", "unknown", "blocked_address", null),
      result("nxdomain", "down", "dns_not_found", null),
      result("up", "up", null, 200),
    ]);
    expect(targetRequests(net, "https://inside.example")).toEqual([]);
  });

  const redirect = (location: string, status = 302): SiteAnswer => ({ status, headers: { Location: location } });
  it.each<[string, SiteAnswer, string, string | null, number | null]>([
    ["200", 200, "up", null, 200],
    ["204", 204, "up", null, 204],
    ["301", redirect("https://elsewhere.example/", 301), "up", null, 301],
    ["302 to the metadata address", redirect("http://169.254.169.254/"), "up", null, 302],
    ["302 to the loopback", redirect("http://127.0.0.1/"), "up", null, 302],
    ["401", 401, "up", null, 401],
    ["403", 403, "up", null, 403],
    ["407", 407, "up", null, 407],
    ["429", 429, "up", null, 429],
    ["418", 418, "up", null, 418],
    ["404", 404, "down", "http_error", 404],
    ["410", 410, "down", "http_error", 410],
    ["500", 500, "down", "http_error", 500],
    ["520", 520, "down", "http_error", 520],
    ["a refused connection", "refused", "down", "connect_failed", null],
    ["a TLS failure", "tls", "down", "tls_error", null],
  ])("stores %s", async (_label, answer, state, reason, httpStatus) => {
    const app = await checkedApp([{ id: "target", url: site("target.example", answer) }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("target", state, reason, httpStatus)]);
    // A redirect is never followed.
    expect(net.requests.filter((request) => !request.url.startsWith(DOH_ENDPOINT)).map((r) => r.url)).toEqual([
      "https://target.example/",
    ]);
  });

  it("stores a target that does not answer in time as down", { timeout: 10_000 }, async () => {
    const app = await checkedApp([{ id: "slow", url: site("slow.example", "hang") }], {
      STATUS_CHECK_TIMEOUT_SECONDS: "2",
    });
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("slow", "down", "timeout", null)]);
  });

  it("sends no credential and its own User-Agent", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    await app.runChecks({ now: NOW });
    const [request] = targetRequests(net, "https://up.example");
    expect(request?.method).toBe("GET");
    for (const name of ["cookie", "authorization", "proxy-authorization", "referer", "cf-connecting-ip", "x-forwarded-for"]) {
      expect(request?.headers.has(name), name).toBe(false);
    }
    expect(request?.headers.get("user-agent")).toMatch(/^YASAD-status\//);
  });

  it("ignores Set-Cookie and a huge body", async () => {
    const app = await checkedApp([
      { id: "up", url: site("up.example", { status: 200, headers: { "Set-Cookie": "id=1" }, body: "huge" }) },
    ]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200)]);
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
  });

  it("checks a link at most once per interval", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    await app.runChecks({ now: NOW });
    const [first] = await statusRows(app);
    const due = Number(first?.due_at);
    expect(due).toBe(Number(first?.checked_at) + INTERVAL);
    for (const at of [NOW + 30_000, due - 1]) await app.runChecks({ now: at });
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    await app.runChecks({ now: due });
    expect(targetRequests(net, "https://up.example")).toHaveLength(2);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200, due)]);
  });

  it("counts the interval from the end of each link's check, not from the run's time", { timeout: 10_000 }, async () => {
    const app = await checkedApp(
      [
        { id: "a", url: site("a.example", "hang") },
        { id: "b", url: site("b.example", 200) },
      ],
      { STATUS_CHECK_INTERVAL_MINUTES: "1", STATUS_CHECK_TIMEOUT_SECONDS: "2", STATUS_CHECK_BATCH: "2", STATUS_CHECK_CONCURRENCY: "1" },
    );
    await app.runChecks({ now: NOW });
    const rows = await statusRows(app);
    // b is checked after a's 2 s timeout: its next check is due one minute after that, not after the run's time.
    for (const row of rows) {
      expect(Number(row.checked_at), String(row.link_id)).toBeGreaterThanOrEqual(NOW + 2000);
      expect(Number(row.due_at), String(row.link_id)).toBe(Number(row.checked_at) + 60_000);
    }
    await app.runChecks({ now: NOW + 60_000 });
    expect(targetRequests(net, "https://b.example")).toHaveLength(1);
  });

  it("checks the links due first first", async () => {
    const app = await checkedApp(
      ["a", "b", "c"].map((id) => ({ id, url: site(`${id}.example`, 200) })),
      { STATUS_CHECK_BATCH: "1" },
    );
    for (const [id, due] of [["a", NOW - 1000], ["b", NOW - 3000], ["c", NOW - 2000]] as const) {
      await app.exec(`insert into link_status (link_id, source, due_at) values ('${id}', 'yasad', ${due})`);
    }
    const contacted = () => ["a", "b", "c"].map((id) => targetRequests(net, `https://${id}.example`).length);
    await app.runChecks({ now: NOW });
    expect(contacted()).toEqual([0, 1, 0]);
    await app.runChecks({ now: NOW });
    expect(contacted()).toEqual([0, 1, 1]);
  });

  it("keeps one result per link", async () => {
    const app = await checkedApp([
      { id: "a", url: site("a.example", 200) },
      { id: "b", url: site("b.example", 500) },
    ]);
    for (const step of [0, 1, 2]) await app.runChecks({ now: NOW + step * INTERVAL });
    expect(await statusRows(app)).toEqual([
      result("a", "up", null, 200, NOW + 2 * INTERVAL),
      result("b", "down", "http_error", 500, NOW + 2 * INTERVAL),
    ]);
  });

  it("never checks more than STATUS_CHECK_BATCH links in a run", async () => {
    const app = await checkedApp(
      [
        { id: "c", url: site("c.example", 200) },
        { id: "a", url: site("a.example", 200) },
        { id: "b", url: site("b.example", 200) },
      ],
      { STATUS_CHECK_BATCH: "2" },
    );
    await app.runChecks({ now: NOW });
    expect(["a", "b", "c"].map((id) => targetRequests(net, `https://${id}.example`).length)).toEqual([1, 1, 0]);
    await app.runChecks({ now: NOW });
    expect(["a", "b", "c"].map((id) => targetRequests(net, `https://${id}.example`).length)).toEqual([1, 1, 1]);
  });

  it("logs and writes nothing when the configuration is invalid", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }], { STATUS_CHECK_BATCH: "0" });
    errors.mockImplementation(() => {});
    await expect(app.runChecks({ now: NOW })).resolves.toBeUndefined();
    expect(net.requests).toEqual([]);
    expect(await statusRows(app)).toEqual([]);
    expect(errors).toHaveBeenCalledOnce();
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/^Status checks failed: /);
    errors.mockClear();
  });

  it("warns when more links are checked than an interval allows", async () => {
    const env = { STATUS_CHECK_BATCH: "1", STATUS_CHECK_INTERVAL_MINUTES: "1" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // An inactive link is never checked, so it does not count.
    const one = await checkedApp(
      [
        { id: "a", url: site("a.example", 200) },
        { id: "asleep", url: site("asleep.example", 200), active: false },
      ],
      env,
    );
    await one.runChecks({ now: NOW });
    expect(warn).not.toHaveBeenCalled();

    const two = await checkedApp(
      [
        { id: "a", url: site("a.example", 200) },
        { id: "b", url: site("b.example", 200) },
      ],
      env,
    );
    await two.runChecks({ now: NOW });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Status checks: 2 links are checked, but this target checks at most 1 per interval; raise STATUS_CHECK_INTERVAL_MINUTES or check fewer links.",
    );
  });
});

/** A row claimed and released without a result: still due, free for the next run. */
const released = (linkId: string) => ({
  link_id: linkId,
  state: null,
  reason: null,
  http_status: null,
  checked_at: null,
  due_at: 0,
  claim_id: null,
  claimed_until: 0,
});

const dohFor = (name: string) => net.requests.filter((r) => r.url.startsWith(`${DOH_ENDPOINT}?name=${name}&`));

describe("scheduled link checks: concurrency, leases and budget", () => {
  it("two runs at once never check a link twice", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const app = await checkedApp(
      ids.map((id) => ({ id, url: site(`${id}.example`, 200) })),
      { STATUS_CHECK_BATCH: "3" },
    );
    await Promise.all([app.runChecks({ now: NOW }), app.runChecks({ now: NOW })]);
    expect(ids.map((id) => targetRequests(net, `https://${id}.example`).length)).toEqual([1, 1, 1, 1, 1]);
    expect(await statusRows(app)).toEqual(ids.map((id) => result(id, "up", null, 200)));
  });

  it("a run in flight keeps its links from the next run", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    const releaseDns = net.hold(DOH_ENDPOINT);
    const first = app.runChecks({ now: NOW });
    await net.seen(DOH_ENDPOINT);
    await app.runChecks({ now: NOW + 20_000 });
    releaseDns();
    await first;
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200)]);
  });

  it("keeps the claim through resolution and request alike", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    const releaseDns = net.hold(DOH_ENDPOINT);
    const first = app.runChecks({ now: NOW });
    await net.seen(DOH_ENDPOINT);
    await app.runChecks({ now: NOW + 20_000 });
    const releaseGet = net.hold("https://up.example");
    releaseDns();
    await net.seen("https://up.example");
    await app.runChecks({ now: NOW + 40_000 });
    releaseGet();
    await first;
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200)]);
  });

  it("a late run keeps its lease and times its result by the wall clock", async () => {
    // Scheduled minutes ago: the lease must run from the wall clock, not from the scheduled time.
    const late = Date.now() - 5 * 60_000;
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    const releaseGet = net.hold("https://up.example");
    const first = app.runChecks({ now: late });
    await net.seen("https://up.example");
    // Past `late + leaseMs` with the defaults (60 s), while the first run is still in flight.
    await app.runChecks({ now: late + 60_000 });
    const releasedAt = Date.now();
    releaseGet();
    await first;
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200, releasedAt)]);
  });

  it("a platform error of the request writes nothing and leaves the link due", async () => {
    const app = await checkedApp([{ id: "busy", url: site("busy.example", "platform") }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([released("busy")]);
    await app.runChecks({ now: NOW });
    expect(targetRequests(net, "https://busy.example")).toHaveLength(2);
    expect(await statusRows(app)).toEqual([released("busy")]);
  });

  it("a platform error of the resolver writes nothing and leaves the link due", async () => {
    net.dns["busy.example"] = { fail: "platform" };
    const app = await checkedApp([{ id: "busy", url: "https://busy.example/" }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([released("busy")]);
    const queries = dohFor("busy.example").length;
    expect(queries).toBeGreaterThan(0);
    await app.runChecks({ now: NOW });
    expect(dohFor("busy.example").length).toBeGreaterThan(queries);
    expect(targetRequests(net, "https://busy.example")).toEqual([]);
    expect(await statusRows(app)).toEqual([released("busy")]);
  });

  it("keeps within the Workers subrequest budget", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `l${String(i).padStart(2, "0")}`);
    const app = await checkedApp(
      ids.map((id) => ({ id, url: site(`${id}.example`, 200) })),
      { STATUS_CHECK_BATCH: "20" },
    );
    const fit = fitBatch(20, WORKERS_BUDGET);
    await app.runChecks({ now: NOW });
    const contacted = () => ids.filter((id) => targetRequests(net, `https://${id}.example`).length > 0);
    expect(contacted()).toEqual(ids.slice(0, fit));
    expect(net.requests.length).toBeLessThanOrEqual(WORKERS_BUDGET.subrequests! - D1_CALLS);
    await app.runChecks({ now: NOW });
    expect(contacted()).toEqual(ids);
    expect(ids.map((id) => targetRequests(net, `https://${id}.example`).length)).toEqual(ids.map(() => 1));
  });

  it("releases what the counted fetch refuses", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `l${i}`);
    for (const id of ids) {
      // Three CNAME hops: four names resolved (A and AAAA each), then the GET: 9 fetches per link.
      net.dns[`${id}.example`] = { cname: `${id}-1.example` };
      net.dns[`${id}-1.example`] = { cname: `${id}-2.example` };
      net.dns[`${id}-2.example`] = { cname: `${id}-3.example` };
      net.dns[`${id}-3.example`] = { a: [PUBLIC_A] };
      net.sites[`https://${id}.example`] = 200;
    }
    const app = await checkedApp(ids.map((id) => ({ id, url: `https://${id}.example/` })));
    await app.runChecks({ now: NOW });
    expect(net.requests.length).toBeLessThanOrEqual(WORKERS_BUDGET.subrequests! - D1_CALLS);
    const rows = await statusRows(app);
    expect(rows).toHaveLength(ids.length);
    const [done, left] = [rows.filter((r) => r.state !== null), rows.filter((r) => r.state === null)];
    // A refusal is never a result: what was checked is up, the rest is released and still due.
    for (const row of done) expect(row).toEqual(result(row.link_id as string, "up", null, 200));
    for (const row of left) expect(row).toEqual(released(row.link_id as string));
    expect(left.length).toBeGreaterThan(0);
  });

  it("drops the result of a run whose claim was taken over", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    const releaseGet = net.hold("https://up.example");
    const first = app.runChecks({ now: NOW });
    await net.seen("https://up.example");
    const until = NOW + 10 * 60_000;
    await app.exec(`update link_status set claim_id = 'other', claimed_until = ${until} where link_id = 'up'`);
    releaseGet();
    await first;
    expect(await statusRows(app)).toEqual([{ ...released("up"), claim_id: "other", claimed_until: until }]);
  });

  it("frees a claim whose run died once its lease ends", async () => {
    const app = await checkedApp([{ id: "up", url: site("up.example", 200) }]);
    await app.exec(
      `insert into link_status (link_id, source, due_at, claim_id, claimed_until) values ('up', 'yasad', 0, 'dead', ${NOW + 1000})`,
    );
    await app.runChecks({ now: NOW });
    expect(net.requests).toEqual([]);
    await app.runChecks({ now: NOW + 1000 });
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200, NOW + 1000)]);
  });
});

describe("scheduled link checks: a link edited during its check", () => {
  /** A checked link `wiki` at https://old.example/, created through the admin API. */
  async function editedApp(): Promise<{ app: TestApp; created: Link }> {
    const app = await adminApp();
    site("old.example", 200);
    site("new.example", 200);
    await newCategory(app, { id: "tools", title: "Tools" });
    const created = await newLink(app, { id: "wiki", title: "Wiki", categoryId: "tools", url: "https://old.example/", check: true });
    return { app, created };
  }

  /** Runs a check of `wiki`, applying `edit` while its request to the old address is in flight. */
  async function editDuringCheck(app: TestApp, edit: () => Promise<void>) {
    const releaseGet = net.hold("https://old.example");
    const run = app.runChecks({ now: NOW });
    await net.seen("https://old.example");
    await edit();
    releaseGet();
    await run;
    expect(await statusRows(app)).toEqual([]);
    expect(targetRequests(net, "https://old.example")).toHaveLength(1);
    expect(targetRequests(net, "https://new.example")).toEqual([]);
  }

  it("drops the result when the address changes", async () => {
    const { app, created } = await editedApp();
    await editDuringCheck(app, async () => {
      const res = await send(app, "PATCH", "/api/admin/links/wiki", { revision: created.revision, url: "https://new.example/" });
      expect(res.status).toBe(200);
    });
  });

  it("keeps the result of the new address over a late result of the old one", async () => {
    const { app, created } = await editedApp();
    net.sites["https://new.example"] = 500;
    const releaseGet = net.hold("https://old.example");
    const first = app.runChecks({ now: NOW });
    await net.seen("https://old.example");
    const res = await send(app, "PATCH", "/api/admin/links/wiki", { revision: created.revision, url: "https://new.example/" });
    expect(res.status).toBe(200);
    await app.runChecks({ now: NOW + 20_000 });
    releaseGet();
    await first;
    expect(await statusRows(app)).toEqual([result("wiki", "down", "http_error", 500, NOW + 20_000)]);
    expect(targetRequests(net, "https://old.example")).toHaveLength(1);
    expect(targetRequests(net, "https://new.example")).toHaveLength(1);
  });

  it("drops the result when the check is turned off", async () => {
    const { app, created } = await editedApp();
    await editDuringCheck(app, async () => {
      const res = await send(app, "PATCH", "/api/admin/links/wiki", { revision: created.revision, check: false });
      expect(res.status).toBe(200);
    });
  });

  it("drops the result when an import changes the address", async () => {
    const { app } = await editedApp();
    await editDuringCheck(app, () =>
      importFile(
        app,
        `version: 1
categories:
  - id: tools
    title: Tools
    groups: ["@everyone"]
    links:
      - id: wiki
        title: Wiki
        url: https://new.example/
        groups: ["@everyone"]
        check: true
`,
      ),
    );
  });
});

/** Runs checks at `NOW` until every link of `app` has a result (a run claims at most one batch). */
async function checkAll(app: TestApp, count: number) {
  for (let run = 0; run < count; run++) {
    await app.runChecks({ now: NOW });
    const [row] = await app.query("select count(*) as n from link_status where state is not null");
    if (Number(row?.n) === count) return;
  }
  throw new Error("some links were never checked");
}

describe("scheduled link checks: SSRF and DNS refusals", () => {
  it("refuses every non-public literal, reserved name, malformed target and bad port without any request", async () => {
    const refused = POLICY_CASES.filter((c) => !c.expected.ok);
    const ids = refused.map((_, i) => `r${String(i).padStart(2, "0")}`);
    const app = await checkedApp(refused.map((c, i) => ({ id: ids[i] as string, url: c.url })));
    await checkAll(app, refused.length);
    expect(await statusRows(app)).toEqual(
      refused.map((c, i) => {
        const code = c.expected.ok ? null : c.expected.code;
        return result(ids[i] as string, "unknown", code === "blocked_port" ? "blocked_port" : "blocked_address", null);
      }),
    );
    // Neither the resolver nor any target was contacted.
    expect(net.requests).toEqual([]);
  });

  it("stores a public literal as unsupported on this target without any request", async () => {
    const app = await checkedApp([{ id: "literal", url: `http://${PUBLIC_A}/` }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("literal", "unknown", "unsupported_on_target", null)]);
    expect(net.requests).toEqual([]);
  });

  it("refuses a name that resolves to any non-public address", async () => {
    const names: [string, DnsEntry][] = [
      ...NON_PUBLIC_ADDRESSES.map((address): DnsEntry => (address.includes(":") ? { aaaa: [address] } : { a: [address] })),
      { a: ["10.0.0.5"] },
      { a: [PUBLIC_A, "127.0.0.1"] },
      { a: [PUBLIC_A], aaaa: ["::1"] },
      { aaaa: ["::ffff:7f00:1"] },
      { aaaa: ["::7f00:1"] },
      { cname: "db.internal" },
    ].map((entry, i) => [`n${String(i).padStart(2, "0")}.example`, entry]);
    net.dns["db.internal"] = { a: ["10.0.0.7"] };
    for (const [name, entry] of names) {
      net.dns[name] = entry;
      net.sites[`https://${name}`] = 200;
    }
    const app = await checkedApp(names.map(([name]) => ({ id: name.split(".")[0] as string, url: `https://${name}/` })));
    await checkAll(app, names.length);
    expect(await statusRows(app)).toEqual(
      names.map(([name]) => result(name.split(".")[0] as string, "unknown", "blocked_address", null)),
    );
    for (const [name] of names) expect(targetRequests(net, `https://${name}`), name).toEqual([]);
    expect(targetRequests(net, "https://db.internal")).toEqual([]);
  });

  const chain = (prefix: string, hops: number): Record<string, DnsEntry> =>
    Object.fromEntries(
      Array.from({ length: hops + 1 }, (_, i): [string, DnsEntry] => [
        i === 0 ? `${prefix}.example` : `${prefix}-${i}.example`,
        i === hops ? { a: [PUBLIC_A] } : { cname: `${prefix}-${i + 1}.example` },
      ]),
    );

  it.each<[string, Record<string, DnsEntry>, string, string]>([
    ["a CNAME loop", { "dns.example": { cname: "loop.example" }, "loop.example": { cname: "dns.example" } }, "unknown", "resolver_failed"],
    ["more than 8 CNAME hops", chain("dns", 9), "unknown", "resolver_failed"],
    ["an unreadable A record", { "dns.example": { a: ["999.1.1.1"] } }, "unknown", "resolver_failed"],
    ["a SERVFAIL", { "dns.example": { status: 2 } }, "unknown", "resolver_failed"],
    ["a truncated answer", { "dns.example": { tc: true } }, "unknown", "resolver_failed"],
    ["an answer that is not JSON", { "dns.example": { raw: "{ not json" } }, "unknown", "resolver_failed"],
    ["an NXDOMAIN", { "dns.example": { status: 3 } }, "down", "dns_not_found"],
    ["a CNAME to a name without address", { "dns.example": { cname: "empty.example" }, "empty.example": {} }, "down", "dns_not_found"],
  ])("stores %s from the resolver", async (_label, dns, state, reason) => {
    Object.assign(net.dns, dns);
    net.sites["https://dns.example"] = 200;
    const app = await checkedApp([{ id: "dns", url: "https://dns.example/" }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("dns", state, reason, null)]);
    expect(dohFor("dns.example").length).toBeGreaterThan(0);
    expect(targetRequests(net, "https://dns.example")).toEqual([]);
  });

  it("follows 8 CNAME hops to a public address", async () => {
    Object.assign(net.dns, chain("dns", 8));
    net.sites["https://dns.example"] = 200;
    const app = await checkedApp([{ id: "dns", url: "https://dns.example/" }]);
    await app.runChecks({ now: NOW });
    expect(await statusRows(app)).toEqual([result("dns", "up", null, 200)]);
  });
});
