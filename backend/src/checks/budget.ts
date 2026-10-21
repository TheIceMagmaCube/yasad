import type { StatusCheckConfig } from "../config";
import { OutboundError } from "../net/outbound";

/** What one scheduled invocation may spend. */
export type RunBudget = {
  /** Time a run may keep chaining batches, ms; 0: one batch only. */
  runMs: number;
  /** Subrequests one invocation may make (fetch and D1 calls), or null when unlimited. */
  subrequests: number | null;
};

/**
 * Workers: one batch per cron tick. The entry cannot know the plan, so the Free limit (50 subrequests) applies to
 * every Worker.
 */
export const WORKERS_BUDGET: RunBudget = { runMs: 0, subrequests: 50 };
/** Docker: batches chained for up to 50 s, inside the one-minute tick, with no subrequest limit. */
export const DOCKER_BUDGET: RunBudget = { runMs: 50_000, subrequests: null };

/** Fetches per link: DoH A, DoH AAAA, GET. */
export const PER_LINK = 3;
/** D1 calls of a run (claim batch, write batch) plus a margin for one CNAME hop. */
export const RESERVED = 5;
/** D1 calls that must stay possible after the checks: the claim batch is done, the write batch is not. */
export const D1_CALLS = 2;
/** Upper bound of a claim, below the 15 minutes a Worker's scheduled invocation may last. */
export const MAX_LEASE_MS = 14 * 60_000;

/**
 * D1 calls a run of `size` links makes: 2 while a `db.batch` counts as one call. The counted fetch gets
 * `subrequests - d1Calls(size)`.
 */
export const d1Calls: (size: number) => number = () => D1_CALLS;

/** Links one batch may claim: the configured batch, capped by the subrequest budget; 0 when it fits no link. */
export function fitBatch(batch: number, budget: RunBudget): number {
  if (budget.subrequests === null) return batch;
  return Math.max(0, Math.min(batch, Math.floor((budget.subrequests - RESERVED) / PER_LINK)));
}

/** Longest a batch of `size` links can take: one timeout per round of concurrent checks. */
export function batchMs(config: StatusCheckConfig, size: number): number {
  return config.timeoutSeconds * 1000 * Math.ceil(size / config.concurrency);
}

/** How long a claim holds: the batch plus 30 s for the writes, at most MAX_LEASE_MS. */
export function leaseMs(config: StatusCheckConfig, size: number): number {
  return Math.min(batchMs(config, size) + 30_000, MAX_LEASE_MS);
}

/** Links a budgeted target can check per interval (one batch a minute), or null when it is not budgeted. */
export function checkCapacity(config: StatusCheckConfig, budget: RunBudget): number | null {
  if (budget.subrequests === null) return null;
  return fitBatch(config.batch, budget) * config.intervalMinutes;
}

/** A fetch that refuses with OutboundError("not_attempted") once `allowance` calls were made, without calling `fetch`. */
export function countedFetch(fetch: typeof globalThis.fetch, allowance: number): typeof globalThis.fetch {
  let made = 0;
  return (input, init) => {
    if (made >= allowance) return Promise.reject(new OutboundError("not_attempted"));
    made += 1;
    return fetch(input, init);
  };
}
