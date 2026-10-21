import { describe, expect, it } from "vitest";

import { fetchOutbound } from "../../src/net/fetch-outbound";
import { OutboundError, type OutboundErrorCode, type OutboundOptions } from "../../src/net/outbound";
import { version } from "../../src/version";

type Call = { url: string; init: RequestInit | undefined };
type Reply = Response | (() => Promise<Response>);

/** A `fetch` that answers each URL from a table (a 200 for anything it does not know) and records every call. */
function stubFetch(table: { [url: string]: Reply } = {}) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    const reply = table[url] ?? new Response("ok");
    return typeof reply === "function" ? reply() : Promise.resolve(reply);
  };
  return { fetch, calls };
}

/** A resolver answering from a table of names, recording every name asked. */
function stubResolve(table: { [name: string]: string[] } = {}) {
  const names: string[] = [];
  const resolve = (name: string): Promise<string[]> => {
    names.push(name);
    return Promise.resolve(table[name] ?? ["93.184.215.14"]);
  };
  return { resolve, names };
}

const OPTIONS: OutboundOptions = { deadlineMs: 1000, maxBytes: 0, maxRedirects: 0 };

async function codeOf(promise: Promise<unknown>): Promise<OutboundErrorCode> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OutboundError);
  return (error as OutboundError).code;
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

describe("fetchOutbound", () => {
  it("reaches a public name once with GET, manual redirects, no cache and its own headers", async () => {
    const stub = stubFetch();
    const dns = stubResolve();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    const response = await outbound.request("https://example.com/status", {
      ...OPTIONS,
      headers: {
        Cookie: "session=secret",
        Authorization: "Bearer secret",
        Referer: "https://yasad.example/",
        "CF-Connecting-IP": "203.0.113.9",
        "X-Forwarded-For": "203.0.113.9",
        "x-forwarded-proto": "https",
      },
    });

    expect(response.status).toBe(200);
    expect(dns.names).toEqual(["example.com"]);
    expect(stub.calls).toHaveLength(1);
    const [call] = stub.calls;
    expect(call?.url).toBe("https://example.com/status");
    expect(call?.init?.method).toBe("GET");
    expect(call?.init?.redirect).toBe("manual");
    expect(call?.init?.cache).toBe("no-store");
    expect(call?.init?.credentials).toBeUndefined();
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("user-agent")).toBe(`YASAD-status/${version} (+https://github.com/TheIceMagmaCube/yasad)`);
    expect(headers.get("accept")).toBe("*/*");
    for (const name of headers.keys()) {
      expect(["cookie", "authorization", "referer", "cf-connecting-ip"]).not.toContain(name);
      expect(name.startsWith("x-forwarded-")).toBe(false);
    }
  });

  it("cancels the body when maxBytes is 0 and returns no body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(16));
      },
      cancel() {
        cancelled = true;
      },
    });
    const stub = stubFetch({ "https://example.com/": new Response(body) });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    const response = await outbound.request("https://example.com/", OPTIONS);

    expect(cancelled).toBe(true);
    expect(response.body).toBeUndefined();
  });

  it("drops Set-Cookie from the headers it returns", async () => {
    const stub = stubFetch({
      "https://example.com/": new Response("ok", { headers: { "Set-Cookie": "a=b", "Content-Type": "text/plain" } }),
    });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    const response = await outbound.request("https://example.com/", OPTIONS);

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("refuses a name when one of its addresses is private, without contacting the target", async () => {
    const stub = stubFetch();
    const dns = stubResolve({ "mixed.example": ["93.184.215.14", "127.0.0.1"] });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    expect(await codeOf(outbound.request("https://mixed.example/", OPTIONS))).toBe("blocked_address");
    expect(stub.calls).toEqual([]);
  });

  it("gives dns_not_found when the resolver finds no address", async () => {
    const stub = stubFetch();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve({ "none.example": [] }).resolve });

    expect(await codeOf(outbound.request("https://none.example/", OPTIONS))).toBe("dns_not_found");
    expect(stub.calls).toEqual([]);
  });

  it("passes a resolver error through", async () => {
    const stub = stubFetch();
    const outbound = fetchOutbound({
      fetch: stub.fetch,
      resolve: () => Promise.reject(new OutboundError("resolver_failed")),
    });

    expect(await codeOf(outbound.request("https://example.com/", OPTIONS))).toBe("resolver_failed");
    expect(stub.calls).toEqual([]);
  });

  it("gives unsupported_on_target for a public IP literal, without any call", async () => {
    const stub = stubFetch();
    const dns = stubResolve();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    expect(await codeOf(outbound.request("http://93.184.215.14/", OPTIONS))).toBe("unsupported_on_target");
    expect(await codeOf(outbound.request("http://[2606:2800:21f:cb07::1]/", OPTIONS))).toBe(
      "unsupported_on_target",
    );
    expect(stub.calls).toEqual([]);
    expect(dns.names).toEqual([]);
  });

  it("gives blocked_address for a private IP literal and for an invalid target", async () => {
    const stub = stubFetch();
    const dns = stubResolve();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    expect(await codeOf(outbound.request("http://10.0.0.5/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("ftp://example.com/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("https://user:pass@example.com/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("not a url", OPTIONS))).toBe("blocked_address");
    expect(stub.calls).toEqual([]);
    expect(dns.names).toEqual([]);
  });

  it("gives blocked_port for a bad port without resolving", async () => {
    const stub = stubFetch();
    const dns = stubResolve();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    expect(await codeOf(outbound.request("http://example.com:6379/", OPTIONS))).toBe("blocked_port");
    expect(dns.names).toEqual([]);
    expect(stub.calls).toEqual([]);
  });

  it("returns a redirect as it is when maxRedirects is 0", async () => {
    const stub = stubFetch({ "https://example.com/": redirect("https://other.example/") });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    const response = await outbound.request("https://example.com/", OPTIONS);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://other.example/");
    expect(stub.calls.map((call) => call.url)).toEqual(["https://example.com/"]);
  });

  it("checks every redirect hop: a 302 to the metadata address ends in blocked_address without contacting it", async () => {
    const stub = stubFetch({ "https://example.com/": redirect("http://169.254.169.254/latest/meta-data/") });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, maxRedirects: 3 }))).toBe(
      "blocked_address",
    );
    expect(stub.calls.map((call) => call.url)).toEqual(["https://example.com/"]);
  });

  it("resolves every redirect hop again", async () => {
    const stub = stubFetch({ "https://example.com/": redirect("https://rebind.example/") });
    const dns = stubResolve({ "rebind.example": ["192.168.1.1"] });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: dns.resolve });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, maxRedirects: 3 }))).toBe(
      "blocked_address",
    );
    expect(dns.names).toEqual(["example.com", "rebind.example"]);
    expect(stub.calls).toHaveLength(1);
  });

  it("follows at most maxRedirects hops, resolving Location against the current URL", async () => {
    const stub = stubFetch({
      "https://example.com/": redirect("/one"),
      "https://example.com/one": redirect("https://two.example/a/"),
      "https://two.example/a/": redirect("b"),
      "https://two.example/a/b": redirect("https://four.example/"),
    });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    const response = await outbound.request("https://example.com/", { ...OPTIONS, maxRedirects: 3 });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://four.example/");
    expect(stub.calls.map((call) => call.url)).toEqual([
      "https://example.com/",
      "https://example.com/one",
      "https://two.example/a/",
      "https://two.example/a/b",
    ]);
  });

  it("reads the body up to maxBytes", async () => {
    const stub = stubFetch({ "https://example.com/": new Response(new Uint8Array(8)) });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    const response = await outbound.request("https://example.com/", { ...OPTIONS, maxBytes: 8 });

    expect(response.body).toEqual(new Uint8Array(8));
  });

  it("gives too_large for a body of maxBytes + 1 bytes", async () => {
    const stub = stubFetch({ "https://example.com/": new Response(new Uint8Array(9)) });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, maxBytes: 8 }))).toBe("too_large");
  });

  it("gives timeout when fetch never answers within the deadline", async () => {
    const stub = stubFetch({ "https://example.com/": () => new Promise<Response>(() => {}) });
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: stubResolve().resolve });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, deadlineMs: 50 }))).toBe("timeout");
  });

  it("shares the deadline with the resolution step", async () => {
    let seen: AbortSignal | null = null;
    const stub = stubFetch();
    const outbound = fetchOutbound({
      fetch: stub.fetch,
      resolve: (_name, signal) => {
        seen = signal;
        return new Promise<string[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new OutboundError("resolver_failed", { cause: signal.reason })));
        });
      },
    });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, deadlineMs: 50 }))).toBe(
      "resolver_failed",
    );
    expect(seen).not.toBeNull();
    expect(stub.calls).toEqual([]);
  });

  it("maps a TypeError from fetch to connect_failed, or tls_error when it names the certificate", async () => {
    const outbound = (error: Error) =>
      fetchOutbound({ fetch: () => Promise.reject(error), resolve: stubResolve().resolve });

    expect(await codeOf(outbound(new TypeError("fetch failed")).request("https://example.com/", OPTIONS))).toBe(
      "connect_failed",
    );
    expect(
      await codeOf(
        outbound(new TypeError("TLS peer's certificate is not trusted")).request("https://example.com/", OPTIONS),
      ),
    ).toBe("tls_error");
    expect(
      await codeOf(outbound(new TypeError("SSL handshake failed")).request("https://example.com/", OPTIONS)),
    ).toBe("tls_error");
  });

  it("maps any other error from fetch to not_attempted", async () => {
    const outbound = fetchOutbound({
      fetch: () => Promise.reject(new Error("Too many subrequests")),
      resolve: stubResolve().resolve,
    });

    expect(await codeOf(outbound.request("https://example.com/", OPTIONS))).toBe("not_attempted");
  });

  it("gives not_attempted when the DoH query hits the subrequest limit", async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://cloudflare-dns.com/")) return Promise.reject(new Error("Too many subrequests."));
      return Promise.resolve(new Response("ok"));
    };
    const outbound = fetchOutbound({ fetch });

    expect(await codeOf(outbound.request("https://example.com/", OPTIONS))).toBe("not_attempted");
    expect(calls.every((url) => url.startsWith("https://cloudflare-dns.com/"))).toBe(true);
  });

  it("gives not_attempted for a TypeError naming the subrequest limit", async () => {
    const outbound = fetchOutbound({
      fetch: () => Promise.reject(new TypeError("Too many subrequests.")),
      resolve: stubResolve().resolve,
    });

    expect(await codeOf(outbound.request("https://example.com/", OPTIONS))).toBe("not_attempted");
  });

  it("keeps not_attempted for a platform error raised after the deadline", async () => {
    const outbound = fetchOutbound({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("Too many subrequests.")), { once: true });
        }),
      resolve: stubResolve().resolve,
    });

    expect(await codeOf(outbound.request("https://example.com/", { ...OPTIONS, deadlineMs: 30 }))).toBe(
      "not_attempted",
    );
  });

  it.each([
    ["a name with a space", { "bad name": "x" }],
    ["a value with a line break", { "X-Ok": "a\nb" }],
  ])("rejects invalid headers (%s) with not_attempted, without any call", async (_label, headers) => {
    const stub = stubFetch();
    const resolver = stubResolve();
    const outbound = fetchOutbound({ fetch: stub.fetch, resolve: resolver.resolve });

    const error: unknown = await outbound
      .request("https://example.com/", { ...OPTIONS, headers })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutboundError);
    expect((error as OutboundError).code).toBe("not_attempted");
    expect(stub.calls).toEqual([]);
    expect(resolver.names).toEqual([]);
  });

  it("resolves through DoH with the given fetch by default", async () => {
    const stub = stubFetch({
      "https://cloudflare-dns.com/dns-query?name=example.com&type=A": new Response(
        JSON.stringify({ Status: 0, Answer: [{ name: "example.com.", type: 1, data: "127.0.0.1" }] }),
      ),
      "https://cloudflare-dns.com/dns-query?name=example.com&type=AAAA": new Response(JSON.stringify({ Status: 0 })),
    });
    const outbound = fetchOutbound({ fetch: stub.fetch });

    expect(await codeOf(outbound.request("https://example.com/", OPTIONS))).toBe("blocked_address");
    expect(stub.calls.map((call) => new URL(call.url).hostname)).toEqual(["cloudflare-dns.com", "cloudflare-dns.com"]);
  });
});
