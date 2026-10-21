import { describe, expect, it, vi } from "vitest";

import {
  batchMs,
  checkCapacity,
  countedFetch,
  d1Calls,
  DOCKER_BUDGET,
  fitBatch,
  leaseMs,
  MAX_LEASE_MS,
  WORKERS_BUDGET,
} from "../../src/checks/budget";
import type { StatusCheckConfig } from "../../src/config";
import { OutboundError } from "../../src/net/outbound";

const defaults: StatusCheckConfig = { intervalMinutes: 5, timeoutSeconds: 10, batch: 10, concurrency: 4 };

describe("fitBatch", () => {
  it("keeps the batch when the budget allows it", () => {
    expect(fitBatch(10, WORKERS_BUDGET)).toBe(10);
    expect(fitBatch(200, DOCKER_BUDGET)).toBe(200);
  });

  it("caps the batch at what the subrequest budget allows", () => {
    expect(fitBatch(200, WORKERS_BUDGET)).toBe(15);
  });

  it("gives 0 when the budget fits no link", () => {
    expect(fitBatch(10, { runMs: 0, subrequests: 7 })).toBe(0);
    expect(fitBatch(10, { runMs: 0, subrequests: 2 })).toBe(0);
  });
});

describe("batchMs and leaseMs", () => {
  it("count one timeout per round of concurrent checks, plus 30 s for the lease", () => {
    expect(batchMs(defaults, 10)).toBe(30_000);
    expect(leaseMs(defaults, 10)).toBe(60_000);
  });

  it("cap the lease at 14 minutes", () => {
    const slow = { ...defaults, timeoutSeconds: 30, concurrency: 1 };
    expect(batchMs(slow, 200)).toBe(6_000_000);
    expect(leaseMs(slow, 200)).toBe(MAX_LEASE_MS);
    expect(MAX_LEASE_MS).toBe(14 * 60_000);
  });
});

describe("checkCapacity", () => {
  it("is the links one interval can check on a budgeted target", () => {
    expect(checkCapacity(defaults, WORKERS_BUDGET)).toBe(50);
    expect(checkCapacity({ ...defaults, batch: 200 }, WORKERS_BUDGET)).toBe(75);
  });

  it("is null when the target has no subrequest budget", () => {
    expect(checkCapacity(defaults, DOCKER_BUDGET)).toBeNull();
  });
});

describe("d1Calls", () => {
  it("counts a db.batch as one call: the claim batch and the write batch", () => {
    for (const size of [0, 1, 15, 200]) expect(d1Calls(size)).toBe(2);
  });
});

describe("countedFetch", () => {
  it("lets the first calls through, then refuses without calling fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const counted = countedFetch(inner, 2);
    await counted("https://a.example/");
    await counted("https://b.example/");
    const refused = counted("https://c.example/");
    await expect(refused).rejects.toBeInstanceOf(OutboundError);
    await expect(refused).rejects.toMatchObject({ code: "not_attempted" });
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("counts a call when it is made, not when it settles", async () => {
    const pending: (() => void)[] = [];
    const inner = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(new Response("ok")));
        }),
    );
    const counted = countedFetch(inner, 2);
    const first = counted("https://a.example/");
    const second = counted("https://b.example/");
    await expect(counted("https://c.example/")).rejects.toMatchObject({ code: "not_attempted" });
    expect(inner).toHaveBeenCalledTimes(2);
    for (const release of pending) release();
    await Promise.all([first, second]);
  });

  it("refuses every call with an allowance of 0", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    await expect(countedFetch(inner, 0)("https://a.example/")).rejects.toMatchObject({ code: "not_attempted" });
    expect(inner).not.toHaveBeenCalled();
  });
});
