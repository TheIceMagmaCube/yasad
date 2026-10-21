import ipaddr from "ipaddr.js";

import { OutboundError } from "./outbound";

/** The DNS-over-HTTPS resolver queried with `?name=<name>&type=A|AAAA`, JSON answers. */
export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** CNAME hops followed from the queried name, within one answer and across queries together. */
const MAX_HOPS = 8;

const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_AAAA = 28;

type DohRecord = { name: string; type: number; data: string };

/** Lower-cased, without the trailing dot DoH answers put on names. */
function normaliseName(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function failed(): OutboundError {
  return new OutboundError("resolver_failed");
}

/** The records of a DoH JSON answer, or a `resolver_failed` error for any shape it does not expect. */
function readRecords(json: unknown): { status: number; records: DohRecord[] } {
  if (typeof json !== "object" || json === null) throw failed();
  const fields = json as { Status?: unknown; TC?: unknown; Answer?: unknown };
  const { Status: status, TC: truncated, Answer: answer } = fields;
  if (typeof status !== "number") throw failed();
  if (truncated !== undefined && typeof truncated !== "boolean") throw failed();
  if (truncated === true) throw failed();
  if (answer !== undefined && !Array.isArray(answer)) throw failed();
  const records = ((answer as unknown[] | undefined) ?? []).map((record): DohRecord => {
    if (typeof record !== "object" || record === null) throw failed();
    const { name, type, data } = record as { name?: unknown; type?: unknown; data?: unknown };
    if (typeof name !== "string" || typeof type !== "number" || typeof data !== "string") throw failed();
    return { name: normaliseName(name), type, data };
  });
  return { status, records };
}

/** The address of an A or AAAA record in its canonical form, or a `resolver_failed` error. */
function readAddress(record: DohRecord): string {
  if (record.type === TYPE_A) {
    if (!ipaddr.IPv4.isValidFourPartDecimal(record.data)) throw failed();
    return ipaddr.IPv4.parse(record.data).toString();
  }
  if (record.data.includes("%") || !ipaddr.IPv6.isValid(record.data)) throw failed();
  return ipaddr.IPv6.parse(record.data).toString();
}

/** One answer read: its addresses, the end of the CNAME chain from `name` (if any), and the names on that chain. */
function parseAnswer(json: unknown, name: string): { addresses: string[]; cname: string | null; chain: string[] } {
  const { status, records } = readRecords(json);
  if (status === 3) return { addresses: [], cname: null, chain: [] };
  if (status !== 0) throw failed();

  const addresses = records
    .filter((record) => record.type === TYPE_A || record.type === TYPE_AAAA)
    .map((record) => readAddress(record));

  const aliases = new Map<string, string>();
  for (const record of records) {
    if (record.type !== TYPE_CNAME) continue;
    const target = normaliseName(record.data);
    if (target === "" || aliases.has(record.name)) throw failed();
    aliases.set(record.name, target);
  }
  const seen = new Set([normaliseName(name)]);
  const chain: string[] = [];
  let current = normaliseName(name);
  for (let next = aliases.get(current); next !== undefined; next = aliases.get(current)) {
    if (seen.has(next) || chain.length === MAX_HOPS) throw failed();
    seen.add(next);
    chain.push(next);
    current = next;
  }
  return { addresses, cname: chain.length > 0 ? current : null, chain };
}

/**
 * Read a DoH JSON answer for `name`: every A and AAAA address it holds, and where the CNAME chain from `name` ends.
 * Fails closed with `resolver_failed` on an unexpected shape, `TC` set, a `Status` other than 0 and 3, an A or AAAA
 * entry that is not an address of its family, a CNAME loop or more than 8 hops. `Status` 3 gives nothing.
 */
export function parseDohAnswer(json: unknown, name: string): { addresses: string[]; cname: string | null } {
  const { addresses, cname } = parseAnswer(json, name);
  return { addresses, cname };
}

/**
 * One DoH query; any failure gives `resolver_failed`, with the abort reason as `cause` once `signal` has aborted: a
 * resolver that does not answer in time says nothing about the target.
 */
async function query(
  name: string,
  type: "A" | "AAAA",
  options: { fetch: typeof fetch; signal: AbortSignal },
): Promise<ReturnType<typeof parseAnswer>> {
  const url = `${DOH_ENDPOINT}?${new URLSearchParams({ name, type }).toString()}`;
  try {
    const response = await options.fetch(url, {
      headers: { Accept: "application/dns-json" },
      redirect: "manual",
      signal: options.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw failed();
    }
    return parseAnswer(await response.json(), name);
  } catch (error) {
    if (options.signal.aborted) throw new OutboundError("resolver_failed", { cause: options.signal.reason });
    if (error instanceof OutboundError) throw error;
    throw new OutboundError("resolver_failed", { cause: error });
  }
}

/**
 * Resolve `name` to its A and AAAA addresses through DoH. A is queried, then AAAA once the A answer has been read, so a
 * resolution holds at most one connection waiting for headers (Workers allows 6 per invocation). A CNAME the answers
 * leave unresolved is queried in turn, up to 8 hops in all. Throws `dns_not_found` when no address is found and
 * `resolver_failed` for any other failure, an aborted `signal` included (its reason as `cause`). The addresses are not
 * checked here: the caller does it.
 */
export async function resolveDoh(
  name: string,
  options: { fetch: typeof fetch; signal: AbortSignal },
): Promise<string[]> {
  if (options.signal.aborted) throw new OutboundError("resolver_failed", { cause: options.signal.reason });
  const seen = new Set([normaliseName(name)]);
  let hops = 0;
  let current = normaliseName(name);
  for (;;) {
    const answers = [await query(current, "A", options), await query(current, "AAAA", options)] as const;
    const addresses = answers.flatMap((answer) => answer.addresses);
    if (addresses.length > 0) {
      hops += Math.max(...answers.map((answer) => answer.chain.length));
      if (hops > MAX_HOPS) throw failed();
      return addresses;
    }

    const targets = new Set(answers.flatMap((answer) => (answer.cname === null ? [] : [answer.cname])));
    if (targets.size === 0) throw new OutboundError("dns_not_found");
    if (targets.size > 1) throw failed();
    const chain = answers[0].chain.length >= answers[1].chain.length ? answers[0].chain : answers[1].chain;
    for (const alias of chain) {
      if (seen.has(alias)) throw failed();
      seen.add(alias);
    }
    hops += chain.length;
    if (hops > MAX_HOPS) throw failed();
    current = [...targets][0] as string;
  }
}
