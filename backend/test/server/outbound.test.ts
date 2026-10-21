// Node-only: the Node outbound implementation against real local servers on 127.0.0.1.
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import { promises as dns } from "node:dns";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { type AddressInfo, connect, type LookupFunction, type Server as NetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fetchOutbound } from "../../src/net/fetch-outbound";
import { OutboundError, type OutboundErrorCode, type OutboundOptions } from "../../src/net/outbound";
import { nodeOutbound, pinnedLookup } from "../../src/server-outbound";
import { version } from "../../src/version";

const OPTIONS: OutboundOptions = { deadlineMs: 2000, maxBytes: 0, maxRedirects: 0 };

type Seen = { method: string | undefined; url: string | undefined; headers: http.IncomingHttpHeaders };

/** A server listening on 127.0.0.1 that counts its TCP connections and records each request. */
type Local = { server: NetServer; port: number; connections: () => number; requests: Seen[] };

const servers: NetServer[] = [];
const sockets: UdpSocket[] = [];
const restores: (() => void)[] = [];

afterEach(async () => {
  for (const restore of restores.splice(0)) restore();
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          (server as http.Server).closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(server: NetServer, requests: Seen[]): Promise<Local> {
  let connections = 0;
  server.on("connection", () => (connections += 1));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, connections: () => connections, requests };
}

/** An HTTP server answering every request with `handler` (a 204 by default). */
function httpServer(handler?: http.RequestListener): Promise<Local> {
  const requests: Seen[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    if (handler) handler(req, res);
    else res.writeHead(204).end();
  });
  return listen(server, requests);
}

/** A port nothing listens on: bound once, then closed. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed: ${code}`), { code });
}

/** A resolver answering from a table: an array of addresses (split by family), or an error code for both families. */
function stubResolver(table: { [name: string]: string[] | string }) {
  const names: string[] = [];
  const answer = (name: string, family: 4 | 6): Promise<string[]> => {
    names.push(name);
    const entry = table[name];
    if (entry === undefined) return Promise.reject(dnsError("ENOTFOUND"));
    if (typeof entry === "string") return Promise.reject(dnsError(entry));
    const addresses = entry.filter((address) => address.includes(":") === (family === 6));
    return addresses.length > 0 ? Promise.resolve(addresses) : Promise.reject(dnsError("ENODATA"));
  };
  return { resolve4: (name: string) => answer(name, 4), resolve6: (name: string) => answer(name, 6), names };
}

async function codeOf(promise: Promise<unknown>): Promise<OutboundErrorCode> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(OutboundError);
  return (error as OutboundError).code;
}

const allowAll = () => true;

describe("nodeOutbound refusals (real policy)", () => {
  it.each<[string, string[] | string, OutboundErrorCode]>([
    ["loopback IPv4", ["127.0.0.1"], "blocked_address"],
    ["one private record among public ones", ["93.184.215.14", "127.0.0.1"], "blocked_address"],
    ["loopback IPv6", ["::1"], "blocked_address"],
    ["IPv4-mapped loopback", ["::ffff:7f00:1"], "blocked_address"],
    ["a name that does not exist", "ENOTFOUND", "dns_not_found"],
    ["a resolver error", "ESERVFAIL", "resolver_failed"],
  ])("refuses evil.test resolving to %s, with no connection", async (_label, entry, code) => {
    const local = await httpServer();
    const outbound = nodeOutbound({ resolver: stubResolver({ "evil.test": entry }) });
    expect(await codeOf(outbound.request(`http://evil.test:${local.port}/`, OPTIONS))).toBe(code);
    expect(local.connections()).toBe(0);
  });

  it("refuses an IPv4-mapped loopback literal before any connection", async () => {
    const local = await httpServer();
    const resolver = stubResolver({});
    const outbound = nodeOutbound({ resolver });
    expect(await codeOf(outbound.request(`http://[::ffff:7f00:1]:${local.port}/`, OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request(`http://127.0.0.1:${local.port}/`, OPTIONS))).toBe("blocked_address");
    expect(local.connections()).toBe(0);
    expect(resolver.names).toEqual([]);
  });

  it("refuses reserved names and bad ports without resolving them", async () => {
    const resolver = stubResolver({});
    const outbound = nodeOutbound({ resolver, isAllowed: allowAll });
    expect(await codeOf(outbound.request("http://localhost:8080/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("http://printer.local/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("http://ok.test:6379/", OPTIONS))).toBe("blocked_port");
    expect(await codeOf(outbound.request("ftp://ok.test/", OPTIONS))).toBe("blocked_address");
    expect(await codeOf(outbound.request("http://user:pass@ok.test/", OPTIONS))).toBe("blocked_address");
    expect(resolver.names).toEqual([]);
  });

  it("refuses a redirect to the metadata address without contacting it", async () => {
    const local = await httpServer((_req, res) => res.writeHead(302, { Location: "http://169.254.169.254/" }).end());
    const outbound = nodeOutbound({
      resolver: stubResolver({ "ok.test": ["127.0.0.1"] }),
      isAllowed: (ip) => ip === "127.0.0.1",
    });
    const request = outbound.request(`http://ok.test:${local.port}/`, { ...OPTIONS, maxRedirects: 3 });
    expect(await codeOf(request)).toBe("blocked_address");
    expect(local.requests).toHaveLength(1);
  });

  it("resolves every redirect hop again and refuses one that resolves to a private address", async () => {
    const local = await httpServer((_req, res) => res.writeHead(302, { Location: "http://evil.test/next" }).end());
    const resolver = stubResolver({ "ok.test": ["127.0.0.1"], "evil.test": ["192.168.1.1"] });
    const outbound = nodeOutbound({ resolver, isAllowed: (ip) => ip === "127.0.0.1" });
    const request = outbound.request(`http://ok.test:${local.port}/`, { ...OPTIONS, maxRedirects: 1 });
    expect(await codeOf(request)).toBe("blocked_address");
    expect(resolver.names).toContain("evil.test");
  });
});

describe("nodeOutbound transport (injected policy)", () => {
  it("reads the status and sends only the outbound headers, with the name as Host", async () => {
    const local = await httpServer((_req, res) => res.writeHead(204, { "Set-Cookie": "a=b", "X-Seen": "1" }).end());
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    const response = await outbound.request(`http://ok.test:${local.port}/path?q=1`, {
      ...OPTIONS,
      headers: { Cookie: "c=d", Authorization: "Bearer x", Referer: "http://a/", "X-Forwarded-For": "1.2.3.4" },
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
    expect(response.headers.get("x-seen")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(local.requests).toHaveLength(1);
    const seen = local.requests[0]!;
    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("/path?q=1");
    expect(seen.headers.host).toBe(`ok.test:${local.port}`);
    expect(seen.headers["user-agent"]).toBe(`YASAD-status/${version} (+https://github.com/TheIceMagmaCube/yasad)`);
    expect(seen.headers.accept).toBe("*/*");
    for (const name of Object.keys(seen.headers)) {
      expect(["cookie", "authorization", "referer", "cf-connecting-ip"]).not.toContain(name);
      expect(name.startsWith("x-forwarded-")).toBe(false);
    }
  });

  it("returns a redirect unfollowed when maxRedirects is 0", async () => {
    const local = await httpServer((_req, res) => res.writeHead(302, { Location: "/elsewhere" }).end());
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    const response = await outbound.request(`http://ok.test:${local.port}/`, OPTIONS);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/elsewhere");
    expect(local.requests).toHaveLength(1);
  });

  it("follows a redirect within maxRedirects and reads the body up to maxBytes", async () => {
    const local = await httpServer((req, res) => {
      if (req.url === "/") res.writeHead(301, { Location: "/final" }).end();
      else res.writeHead(200).end("hello");
    });
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    const response = await outbound.request(`http://ok.test:${local.port}/`, {
      ...OPTIONS,
      maxRedirects: 1,
      maxBytes: 5,
    });
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("hello");
    const tooLarge = outbound.request(`http://ok.test:${local.port}/final`, { ...OPTIONS, maxBytes: 4 });
    expect(await codeOf(tooLarge)).toBe("too_large");
  });

  it("gives timeout within the deadline when the server never answers", async () => {
    const local = await httpServer(() => {});
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    const started = performance.now();
    expect(await codeOf(outbound.request(`http://ok.test:${local.port}/`, { ...OPTIONS, deadlineMs: 300 }))).toBe(
      "timeout",
    );
    expect(performance.now() - started).toBeLessThan(300 + 200);
  });

  it("gives connect_failed on a closed port", async () => {
    const port = await closedPort();
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    expect(await codeOf(outbound.request(`http://ok.test:${port}/`, OPTIONS))).toBe("connect_failed");
  });

  it("gives tls_error on a self-signed certificate", async () => {
    const fixtures = new URL("./fixtures/", import.meta.url);
    const server = https.createServer(
      {
        key: readFileSync(new URL("self-signed.key", fixtures)),
        cert: readFileSync(new URL("self-signed.crt", fixtures)),
      },
      (_req, res) => res.writeHead(200).end(),
    );
    const local = await listen(server, []);
    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    expect(await codeOf(outbound.request(`https://ok.test:${local.port}/`, OPTIONS))).toBe("tls_error");
    expect(local.connections()).toBe(1);
  });

  it("never goes through a proxy set in the environment", async () => {
    const proxy = await httpServer((_req, res) => res.writeHead(502).end());
    const target = await httpServer();
    const saved = { HTTP_PROXY: process.env.HTTP_PROXY, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY };
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`;
    process.env.NODE_USE_ENV_PROXY = "1";
    // What NODE_USE_ENV_PROXY does at startup, whatever the Node 24 minor: a global agent sending every connection to
    // the proxy.
    class ProxyAgent extends http.Agent {
      override createConnection(): Socket {
        return connect(proxy.port, "127.0.0.1");
      }
    }
    const globalAgent = http.globalAgent;
    http.globalAgent = new ProxyAgent();
    restores.push(() => {
      http.globalAgent.destroy();
      http.globalAgent = globalAgent;
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    // Control: the global agent now goes through the proxy.
    await new Promise<void>((resolve) => {
      http.get(`http://ok.test:${target.port}/`, (res) => res.resume().on("end", resolve)).on("error", () => resolve());
    });
    expect(proxy.connections()).toBe(1);

    const outbound = nodeOutbound({ resolver: stubResolver({ "ok.test": ["127.0.0.1"] }), isAllowed: allowAll });
    const response = await outbound.request(`http://ok.test:${target.port}/`, OPTIONS);
    expect(response.status).toBe(204);
    expect(proxy.connections()).toBe(1);
    expect(target.requests).toHaveLength(1);
  });

  it.each([
    ["a name with a space", { "bad name": "x" }],
    ["a value with a line break", { "X-Ok": "a\nb" }],
  ])(
    "rejects invalid headers (%s) with not_attempted, before any resolution or connection",
    async (_label, headers) => {
      const local = await httpServer();
      const resolver = stubResolver({ "ok.test": ["127.0.0.1"] });
      const outbound = nodeOutbound({ resolver, isAllowed: allowAll });
      const error: unknown = await outbound
        .request(`http://ok.test:${local.port}/`, { ...OPTIONS, headers })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OutboundError);
      expect((error as OutboundError).code).toBe("not_attempted");
      expect(resolver.names).toEqual([]);
      expect(local.connections()).toBe(0);
    },
  );
});

describe("pinnedLookup", () => {
  function call(lookup: LookupFunction, options: Parameters<LookupFunction>[1]) {
    return new Promise<{ error: Error | null; address: unknown; family: unknown }>((resolve) => {
      lookup("ok.test", options, (error, address, family) => resolve({ error, address, family }));
    });
  }

  it("returns every validated address with all: true", async () => {
    const lookup = pinnedLookup(["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]);
    expect(await call(lookup, { all: true })).toEqual({
      error: null,
      address: [
        { address: "93.184.215.14", family: 4 },
        { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 },
      ],
      family: undefined,
    });
  });

  it("returns the first validated address with all: false", async () => {
    const lookup = pinnedLookup(["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]);
    expect(await call(lookup, { all: false })).toEqual({ error: null, address: "93.184.215.14", family: 4 });
    expect(await call(lookup, {})).toEqual({ error: null, address: "93.184.215.14", family: 4 });
  });

  it("keeps to the family asked for", async () => {
    const lookup = pinnedLookup(["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]);
    expect(await call(lookup, { family: 6 })).toEqual({
      error: null,
      address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
      family: 6,
    });
    expect(await call(lookup, { family: 6, all: true })).toEqual({
      error: null,
      address: [{ address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 }],
      family: undefined,
    });
  });
});

describe("a resolver that never answers", () => {
  it("gives resolver_failed on both targets, never timeout", async () => {
    const never = () => new Promise<string[]>(() => {});
    const node = nodeOutbound({ resolver: { resolve4: never, resolve6: never } });
    const fetched = fetchOutbound({ fetch: () => Promise.reject(new Error("no fetch expected")), resolve: never });
    const options = { ...OPTIONS, deadlineMs: 100 };
    expect(await codeOf(node.request("http://slow.test/", options))).toBe("resolver_failed");
    expect(await codeOf(fetched.request("http://slow.test/", options))).toBe("resolver_failed");
  });
});

describe("nodeOutbound and the libuv threadpool", () => {
  async function readsStayFast(checks: Promise<OutboundErrorCode>[]) {
    const dir = await mkdtemp(join(tmpdir(), "yasad-outbound-"));
    try {
      const file = join(dir, "small.txt");
      await writeFile(file, "static");
      const started = performance.now();
      await Promise.all(Array.from({ length: 20 }, () => readFile(file)));
      expect(performance.now() - started).toBeLessThan(500);
      expect(await Promise.all(checks)).toEqual(Array.from({ length: 6 }, () => "resolver_failed"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("keeps file reads fast while 6 checks wait on a resolver that never answers", async () => {
    const never = () => new Promise<string[]>(() => {});
    const outbound = nodeOutbound({ resolver: { resolve4: never, resolve6: never } });
    const checks = Array.from({ length: 6 }, (_, i) =>
      codeOf(outbound.request(`http://slow${i}.test/`, { ...OPTIONS, deadlineMs: 2000 })),
    );
    await readsStayFast(checks);
  });

  it("keeps file reads fast while 6 checks wait on a DNS server that never answers", async () => {
    const silent = createSocket("udp4");
    sockets.push(silent);
    await new Promise<void>((resolve) => silent.bind(0, "127.0.0.1", resolve));
    const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
    resolver.setServers([`127.0.0.1:${silent.address().port}`]);
    restores.push(() => resolver.cancel());
    const outbound = nodeOutbound({ resolver });
    const checks = Array.from({ length: 6 }, (_, i) =>
      codeOf(outbound.request(`http://slow${i}.test/`, { ...OPTIONS, deadlineMs: 2000 })),
    );
    await readsStayFast(checks);
  });
});
