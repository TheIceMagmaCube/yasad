// Fake network for the scheduled checks: a DoH resolver answering from a table of names, and sites answering from
// a table of origins, behind one `fetch` the tests stub in. Nothing is kept between calls but what the test sets
// and the request log. Any URL it does not know is recorded in `unexpected` and rejected.

import { DOH_ENDPOINT } from "../../src/net/doh";

/** A DoH answer: addresses or a CNAME (Status 0), a Status, a truncated or unreadable answer, a platform error, or none. */
export type DnsEntry =
  | { a?: string[]; aaaa?: string[]; cname?: string }
  | { status: number }
  | { tc: true }
  | { raw: string }
  | { fail: "platform" }
  | { hang: true };

/** A site's answer: a status with an empty body, a status with headers or a huge body, or a failure. */
export type SiteAnswer =
  | number
  | { status: number; headers?: Record<string, string>; body?: "huge" }
  | "hang"
  | "refused"
  | "tls"
  | "platform";

export type FakeRequest = { url: string; method: string; headers: Headers };

export type FakeNet = {
  /** Names, lower case, without the trailing dot. */
  dns: Record<string, DnsEntry>;
  /** Origins, e.g. "https://up.example". */
  sites: Record<string, SiteAnswer>;
  /** Every request, DoH included, oldest first. */
  requests: FakeRequest[];
  /** URLs that matched nothing; each also rejected. */
  unexpected: string[];
  /** Requests whose URL starts with `prefix` wait until the returned function is called. */
  hold(prefix: string): () => void;
  /** Resolves once a request whose URL starts with `prefix` has arrived. */
  seen(prefix: string): Promise<void>;
  /** Honours `init.signal`: rejects with its reason on abort. */
  fetch: typeof globalThis.fetch;
};

const HUGE_BYTES = 8 * 1024 * 1024;
const CHUNK = 64 * 1024;

/** A body of `HUGE_BYTES` zeros, produced only as it is read. */
function hugeBody(): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= HUGE_BYTES) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(CHUNK));
      sent += CHUNK;
    },
  });
}

function aborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason as Error);
    else signal.addEventListener("abort", () => reject(signal.reason as Error), { once: true });
  });
}

function dnsAnswer(name: string, type: string, entry: DnsEntry): Response | "platform" | "hang" {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/dns-json" } });
  if ("fail" in entry) return "platform";
  if ("hang" in entry) return "hang";
  if ("raw" in entry) return new Response(entry.raw, { headers: { "Content-Type": "application/dns-json" } });
  if ("tc" in entry) return json({ Status: 0, TC: true });
  if ("status" in entry) return json({ Status: entry.status });
  if (entry.cname !== undefined) return json({ Status: 0, Answer: [{ name: `${name}.`, type: 5, data: `${entry.cname}.` }] });
  const [code, addresses] = type === "AAAA" ? [28, entry.aaaa ?? []] : [1, entry.a ?? []];
  return json({ Status: 0, Answer: addresses.map((data) => ({ name: `${name}.`, type: code, data })) });
}

function siteAnswer(answer: SiteAnswer): Response | "hang" | Error {
  if (answer === "hang") return "hang";
  if (answer === "refused") return new TypeError("fetch failed");
  if (answer === "tls") return new TypeError("certificate has expired");
  if (answer === "platform") return new Error("Too many subrequests.");
  if (typeof answer === "number") return new Response(null, { status: answer });
  return new Response(answer.body === "huge" ? hugeBody() : null, { status: answer.status, headers: answer.headers });
}

export function fakeNet(): FakeNet {
  const holds = new Map<string, Promise<void>>();
  const watchers: { prefix: string; resolve: () => void }[] = [];

  const net: FakeNet = {
    dns: {},
    sites: {},
    requests: [],
    unexpected: [],
    hold(prefix) {
      let release!: () => void;
      holds.set(prefix, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        holds.delete(prefix);
        release();
      };
    },
    seen(prefix) {
      if (net.requests.some((request) => request.url.startsWith(prefix))) return Promise.resolve();
      return new Promise((resolve) => watchers.push({ prefix, resolve }));
    },
    async fetch(input, init) {
      const request = input instanceof Request ? input : null;
      const url = request?.url ?? String(input);
      const method = init?.method ?? request?.method ?? "GET";
      const headers = new Headers(init?.headers ?? request?.headers);
      net.requests.push({ url, method, headers });
      for (const watcher of watchers.splice(0)) {
        if (url.startsWith(watcher.prefix)) watcher.resolve();
        else watchers.push(watcher);
      }
      const signal = init?.signal ?? request?.signal;
      const abort = aborted(signal);
      abort.catch(() => {});

      for (const [prefix, held] of holds) {
        if (url.startsWith(prefix)) await Promise.race([held, abort]);
      }

      let answer: Response | "platform" | "hang" | Error | undefined;
      if (url.startsWith(`${DOH_ENDPOINT}?`)) {
        const params = new URL(url).searchParams;
        const name = (params.get("name") ?? "").toLowerCase().replace(/\.$/, "");
        const entry = net.dns[name];
        if (entry !== undefined) answer = dnsAnswer(name, params.get("type") ?? "A", entry);
      } else {
        const site = net.sites[new URL(url).origin];
        if (site !== undefined) answer = siteAnswer(site);
      }

      if (answer === undefined) {
        net.unexpected.push(url);
        throw new Error(`unexpected request: ${url}`);
      }
      if (answer === "platform") throw new Error("Too many subrequests.");
      if (answer === "hang") return abort;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return net;
}

/** The requests sent to `origin`, oldest first. */
export const targetRequests = (net: FakeNet, origin: string): FakeRequest[] =>
  net.requests.filter((request) => new URL(request.url).origin === origin);
