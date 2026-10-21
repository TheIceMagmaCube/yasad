import { and, count, eq, exists, sql } from "drizzle-orm";

import type { StatusCheckConfig } from "../config";
import type { DB } from "../db";
import { type Classification, classify } from "../net/classify";
import { type Outbound, OutboundError } from "../net/outbound";
import { link, linkStatus } from "../schema";
import { checkCapacity, countedFetch, d1Calls, fitBatch, leaseMs, type RunBudget } from "./budget";

/** What a run did: batches claimed, links claimed, results written, links released without a result. */
export type RunSummary = { batches: number; claimed: number; written: number; released: number };

/** The source of the results this module writes. */
const SOURCE = "yasad";

/** Runs `task` on every item, at most `limit` at once; never rejects (a task error is the task's to handle). */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        await task(item);
      } catch {
        // The task reports its own failures; one must not stop the others.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}

/** One check: the classified result, or null when the check was not attempted (nothing is written). */
async function check(outbound: Outbound, url: string, config: StatusCheckConfig): Promise<Classification | null> {
  try {
    return classify(
      await outbound.request(url, { method: "GET", deadlineMs: config.timeoutSeconds * 1000, maxBytes: 0, maxRedirects: 0 }),
    );
  } catch (error) {
    return error instanceof OutboundError ? classify(error) : null;
  }
}

/**
 * One scheduled run of the link checks at `now`: claims up to `fitBatch(config.batch, budget)` due links in one
 * batch (an upsert on `link_status`, so two runs never claim the same link), checks them with at most
 * `config.concurrency` in flight, then writes every result and releases the rest in one batch. A result is written
 * only while the claim is still the run's and the link still has the URL that was checked, with its check on. A link
 * not attempted (platform error, refused by the counted fetch) is released and stays due. Under a subrequest budget
 * the run's fetches are counted, and a warning is logged when more links are checked than an interval allows.
 */
export async function runChecks(input: {
  db: DB;
  config: StatusCheckConfig;
  /** Builds the run's client; `fetch` is the run's counted fetch (Workers), ignored by the Node client. */
  outbound: (fetch: typeof globalThis.fetch) => Outbound;
  now: number;
  budget: RunBudget;
}): Promise<RunSummary> {
  const { db, config, now: t, budget } = input;
  const summary: RunSummary = { batches: 0, claimed: 0, written: 0, released: 0 };
  const size = fitBatch(config.batch, budget);
  if (size === 0) return summary;
  const capacity = checkCapacity(config, budget);

  const run = crypto.randomUUID();
  // A late start must not shorten the lease: the next run compares it with its own scheduled time.
  const claimedUntil = Math.max(t, Date.now()) + leaseMs(config, size);
  // The columns of link_status in the order of the table.
  const claim = db
    .insert(linkStatus)
    .select(
      sql`select l.id, ${SOURCE}, null, null, null, null, 0, ${run}, ${claimedUntil}
        from link l left join link_status s on s.link_id = l.id and s.source = ${SOURCE}
        where l.check_enabled = 1 and l.active = 1
          and (s.link_id is null or (s.due_at <= ${t} and s.claimed_until <= ${t}))
        order by coalesce(s.due_at, 0), l.id
        limit ${size}`,
    )
    .onConflictDoUpdate({
      target: [linkStatus.linkId, linkStatus.source],
      set: { claimId: sql`excluded.claim_id`, claimedUntil: sql`excluded.claimed_until` },
      setWhere: sql`${linkStatus.dueAt} <= ${t} and ${linkStatus.claimedUntil} <= ${t}`,
    });
  const claimed = db
    .select({ id: link.id, url: link.url })
    .from(linkStatus)
    .innerJoin(link, eq(link.id, linkStatus.linkId))
    .where(and(eq(linkStatus.source, SOURCE), eq(linkStatus.claimId, run)))
    .orderBy(link.id);
  const checked = db
    .select({ n: count() })
    .from(link)
    .where(and(eq(link.check, true), eq(link.active, true)));
  const results = await (capacity === null ? db.batch([claim, claimed]) : db.batch([claim, claimed, checked]));
  summary.batches = 1;

  if (capacity !== null) {
    const total = (results[2] as { n: number }[])[0]?.n ?? 0;
    if (total > capacity) {
      console.warn(
        `Status checks: ${total} links are checked, but this target checks at most ${capacity} per interval; raise STATUS_CHECK_INTERVAL_MINUTES or check fewer links.`,
      );
    }
  }

  const links = results[1] as { id: string; url: string }[];
  summary.claimed = links.length;
  if (links.length === 0) return summary;

  // Read at call time, so a stubbed global fetch is the one used.
  const base: typeof globalThis.fetch = (resource, init) => fetch(resource, init);
  const outbound = input.outbound(
    budget.subrequests === null ? base : countedFetch(base, budget.subrequests - d1Calls(size)),
  );
  const found: { id: string; url: string; result: Classification }[] = [];
  await eachLimited(links, config.concurrency, async ({ id, url }) => {
    const result = await check(outbound, url, config);
    if (result !== null) found.push({ id, url, result });
  });

  const writes = found.map(({ id, url, result }) =>
    db
      .update(linkStatus)
      .set({
        state: result.state,
        reason: result.reason,
        httpStatus: result.httpStatus,
        checkedAt: new Date(t),
        dueAt: t + config.intervalMinutes * 60_000,
        claimId: null,
        claimedUntil: 0,
      })
      .where(
        and(
          eq(linkStatus.linkId, id),
          eq(linkStatus.source, SOURCE),
          eq(linkStatus.claimId, run),
          exists(
            db
              .select({ one: sql`1` })
              .from(link)
              .where(and(eq(link.id, id), eq(link.url, url), eq(link.check, true))),
          ),
        ),
      ),
  );
  // Last: releases the links not attempted and any row whose result was dropped.
  const release = db
    .update(linkStatus)
    .set({ claimId: null, claimedUntil: 0 })
    .where(and(eq(linkStatus.source, SOURCE), eq(linkStatus.claimId, run)));
  // A failure rejects to the caller, which logs it; the claims then expire with their lease.
  await db.batch([...writes, release] as unknown as readonly [unknown, ...unknown[]]);
  summary.written = found.length;
  summary.released = links.length - found.length;
  return summary;
}
