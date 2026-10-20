import { describe, expect, it } from "vitest";

import { DOH_ENDPOINT, parseDohAnswer, resolveDoh } from "../../src/net/doh";
import { OutboundError, type OutboundErrorCode } from "../../src/net/outbound";

type Record = { name: string; type: number; data: string };
type Answer = { status: number; body: unknown } | "reject";

/** A DoH answer as Cloudflare shapes it. */
function answer(records: Record[], extra: { Status?: number; TC?: boolean } = {}): Answer {
  return { status: 200, body: { Status: 0, TC: false, RD: true, RA: true, Answer: records, ...extra } };
}

const a = (name: string, data: string): Record => ({ name: `${name}.`, type: 1, data });
const aaaa = (name: string, data: string): Record => ({ name: `${name}.`, type: 28, data });
const cname = (name: string, target: string): Record => ({ name: `${name}.`, type: 5, data: `${target}.` });

/**
 * A `fetch` that answers DoH queries from a table keyed by `<name> <type>`, records every request, and answers an
 * empty NOERROR for anything it does not know.
 */
function stubFetch(table: { [query: string]: Answer }) {
  const requests: { url: URL; accept: string | null }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, accept: new Headers(init?.headers).get("accept") });
    const entry = table[`${url.searchParams.get("name")} ${url.searchParams.get("type")}`] ?? answer([]);
    if (entry === "reject") return Promise.reject(new TypeError("network error"));
    const body = typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body);
    return Promise.resolve(new Response(body, { status: entry.status }));
  };
  return { fetch, requests };
}

async function codeOf(promise: Promise<unknown>): Promise<OutboundErrorCode> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OutboundError);
  return (error as OutboundError).code;
}

function resolve(name: string, table: { [query: string]: Answer }, signal = new AbortController().signal) {
  const stub = stubFetch(table);
  return { promise: resolveDoh(name, { fetch: stub.fetch, signal }), requests: stub.requests };
}

describe("parseDohAnswer", () => {
  it("collects A and AAAA records of mixed types, ignoring the others", () => {
    const json = answer([
      a("example.com", "93.184.215.14"),
      aaaa("example.com", "2606:2800:21f:cb07::1"),
      { name: "example.com.", type: 46, data: "a 13 2 300 ..." },
    ]);
    expect(parseDohAnswer((json as { body: unknown }).body, "example.com")).toEqual({
      addresses: ["93.184.215.14", "2606:2800:21f:cb07::1"],
      cname: null,
    });
  });

  it("returns the end of a CNAME chain", () => {
    const json = answer([cname("www.example.com", "a.cdn.test"), cname("a.cdn.test", "b.cdn.test")]);
    expect(parseDohAnswer((json as { body: unknown }).body, "www.example.com")).toEqual({
      addresses: [],
      cname: "b.cdn.test",
    });
  });

  it("gives no address and no CNAME for Status 3", () => {
    expect(parseDohAnswer({ Status: 3, TC: false, Answer: [cname("x.test", "y.test")] }, "x.test")).toEqual({
      addresses: [],
      cname: null,
    });
  });

  it.each<[string, unknown]>([
    ["not an object", "nope"],
    ["null", null],
    ["no Status", { TC: false }],
    ["Status 2 (SERVFAIL)", { Status: 2, TC: false }],
    ["Status 5 (REFUSED)", { Status: 5, TC: false }],
    ["TC set", { Status: 0, TC: true, Answer: [a("x.test", "93.184.215.14")] }],
    ["TC not a boolean", { Status: 0, TC: "no" }],
    ["Answer not an array", { Status: 0, TC: false, Answer: {} }],
    ["record without data", { Status: 0, TC: false, Answer: [{ name: "x.test.", type: 1 }] }],
    ["A entry not an IP", { Status: 0, TC: false, Answer: [a("x.test", "not-an-ip")] }],
    ["A entry holding an IPv6", { Status: 0, TC: false, Answer: [a("x.test", "::1")] }],
    ["A entry in a short form", { Status: 0, TC: false, Answer: [a("x.test", "127.1")] }],
    ["AAAA entry holding an IPv4", { Status: 0, TC: false, Answer: [aaaa("x.test", "93.184.215.14")] }],
    ["AAAA entry with a zone", { Status: 0, TC: false, Answer: [aaaa("x.test", "fe80::1%eth0")] }],
    ["CNAME loop", { Status: 0, TC: false, Answer: [cname("x.test", "y.test"), cname("y.test", "x.test")] }],
  ])("fails closed on %s", (_label, json) => {
    expect(() => parseDohAnswer(json, "x.test")).toThrow(expect.objectContaining({ code: "resolver_failed" }));
  });
});

describe("resolveDoh", () => {
  it("queries A and AAAA at the endpoint with the DoH JSON Accept header", async () => {
    const { promise, requests } = resolve("example.com", {
      "example.com A": answer([a("example.com", "93.184.215.14")]),
    });
    await expect(promise).resolves.toEqual(["93.184.215.14"]);
    expect(requests.map(({ url }) => url.href).sort()).toEqual([
      `${DOH_ENDPOINT}?name=example.com&type=A`,
      `${DOH_ENDPOINT}?name=example.com&type=AAAA`,
    ]);
    expect(DOH_ENDPOINT).toBe("https://cloudflare-dns.com/dns-query");
    expect(requests.every(({ accept }) => accept === "application/dns-json")).toBe(true);
  });

  it("returns AAAA addresses alone", async () => {
    const { promise } = resolve("v6.test", { "v6.test AAAA": answer([aaaa("v6.test", "2001:db8::1")]) });
    await expect(promise).resolves.toEqual(["2001:db8::1"]);
  });

  it("returns every address of both families", async () => {
    const { promise } = resolve("mixed.test", {
      "mixed.test A": answer([a("mixed.test", "93.184.215.14"), a("mixed.test", "127.0.0.1")]),
      "mixed.test AAAA": answer([aaaa("mixed.test", "::1")]),
    });
    await expect(promise).resolves.toEqual(["93.184.215.14", "127.0.0.1", "::1"]);
  });

  it("follows a CNAME that the answer leaves unresolved", async () => {
    const { promise, requests } = resolve("www.example.com", {
      "www.example.com A": answer([cname("www.example.com", "edge.cdn.test")]),
      "www.example.com AAAA": answer([cname("www.example.com", "edge.cdn.test")]),
      "edge.cdn.test A": answer([a("edge.cdn.test", "93.184.215.14")]),
    });
    await expect(promise).resolves.toEqual(["93.184.215.14"]);
    expect(requests.map(({ url }) => url.searchParams.get("name"))).toContain("edge.cdn.test");
  });

  it("takes the addresses of a CNAME chain resolved in the same answer", async () => {
    const { promise } = resolve("www.example.com", {
      "www.example.com A": answer([cname("www.example.com", "edge.cdn.test"), a("edge.cdn.test", "93.184.215.14")]),
    });
    await expect(promise).resolves.toEqual(["93.184.215.14"]);
  });

  it("fails on a CNAME loop across queries", async () => {
    const { promise } = resolve("x.test", {
      "x.test A": answer([cname("x.test", "y.test")]),
      "y.test A": answer([cname("y.test", "x.test")]),
    });
    expect(await codeOf(promise)).toBe("resolver_failed");
  });

  it("follows 8 hops and fails at the ninth", async () => {
    const chain = (length: number) => {
      const table: { [query: string]: Answer } = {};
      for (let hop = 0; hop < length; hop++) {
        table[`h${hop}.test A`] = answer([cname(`h${hop}.test`, `h${hop + 1}.test`)]);
      }
      table[`h${length}.test A`] = answer([a(`h${length}.test`, "93.184.215.14")]);
      return table;
    };
    await expect(resolve("h0.test", chain(8)).promise).resolves.toEqual(["93.184.215.14"]);
    expect(await codeOf(resolve("h0.test", chain(9)).promise)).toBe("resolver_failed");
  });

  it("fails at the ninth hop of a chain given in one answer", async () => {
    const records = Array.from({ length: 9 }, (_, hop) => cname(`h${hop}.test`, `h${hop + 1}.test`));
    const { promise } = resolve("h0.test", { "h0.test A": answer([...records, a("h9.test", "93.184.215.14")]) });
    expect(await codeOf(promise)).toBe("resolver_failed");
  });

  it.each<[string, Answer, OutboundErrorCode]>([
    ["Status 2 (SERVFAIL)", answer([], { Status: 2 }), "resolver_failed"],
    ["Status 3 (NXDOMAIN)", answer([], { Status: 3 }), "dns_not_found"],
    ["TC set", answer([a("x.test", "93.184.215.14")], { TC: true }), "resolver_failed"],
    ["invalid JSON", { status: 200, body: "{not json" }, "resolver_failed"],
    ["an A entry that is not an IP", answer([a("x.test", "not-an-ip")]), "resolver_failed"],
    ["an answer with only a CNAME", answer([cname("x.test", "y.test")]), "dns_not_found"],
    ["HTTP 500", { status: 500, body: { Status: 0, Answer: [a("x.test", "93.184.215.14")] } }, "resolver_failed"],
    ["HTTP 302", { status: 302, body: "" }, "resolver_failed"],
    ["a rejected fetch", "reject", "resolver_failed"],
  ])("gives %s as its code", async (_label, entry, code) => {
    const { promise } = resolve("x.test", { "x.test A": entry, "x.test AAAA": answer([]) });
    expect(await codeOf(promise)).toBe(code);
  });

  it("fails when the AAAA query fails even though A answered", async () => {
    const { promise } = resolve("x.test", {
      "x.test A": answer([a("x.test", "93.184.215.14")]),
      "x.test AAAA": answer([], { Status: 2 }),
    });
    expect(await codeOf(promise)).toBe("resolver_failed");
  });

  it("gives dns_not_found when neither family has an address", async () => {
    expect(await codeOf(resolve("empty.test", {}).promise)).toBe("dns_not_found");
  });

  it("gives timeout when the signal is already aborted, without a request", async () => {
    const controller = new AbortController();
    controller.abort();
    const { promise, requests } = resolve("x.test", {}, controller.signal);
    expect(await codeOf(promise)).toBe("timeout");
    expect(requests).toHaveLength(0);
  });

  it("gives timeout when the signal aborts while the query waits", async () => {
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const promise = resolveDoh("x.test", { fetch, signal: controller.signal });
    controller.abort(new DOMException("deadline", "TimeoutError"));
    expect(await codeOf(promise)).toBe("timeout");
  });
});
