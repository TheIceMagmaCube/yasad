import { type TestApp, testApp, type TestEnv } from "#harness";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { DOH_ENDPOINT } from "../../src/net/doh";
import { type FakeNet, fakeNet, type SiteAnswer, targetRequests } from "../harness/fake-net";

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

const result = (linkId: string, state: string, reason: string | null, httpStatus: number | null, now = NOW) => ({
  link_id: linkId,
  state,
  reason,
  http_status: httpStatus,
  checked_at: now,
  due_at: now + INTERVAL,
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
    for (const at of [NOW, NOW + 30_000, NOW + INTERVAL - 1]) await app.runChecks({ now: at });
    expect(targetRequests(net, "https://up.example")).toHaveLength(1);
    await app.runChecks({ now: NOW + INTERVAL });
    expect(targetRequests(net, "https://up.example")).toHaveLength(2);
    expect(await statusRows(app)).toEqual([result("up", "up", null, 200, NOW + INTERVAL)]);
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

    const one = await checkedApp([{ id: "a", url: site("a.example", 200) }], env);
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
