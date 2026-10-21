import { describe, expect, it } from "vitest";

import { eachLimited } from "../../src/checks/run";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("eachLimited", () => {
  it("never runs more than the limit at once, starts in list order and runs every item", async () => {
    const items = [1, 2, 3, 4, 5];
    const gates = new Map(items.map((item) => [item, gate()]));
    const started: number[] = [];
    let inFlight = 0;
    let peak = 0;
    const done = eachLimited(items, 2, async (item) => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates.get(item)!.opened;
      inFlight -= 1;
    });
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    gates.get(2)!.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([1, 2, 3]);
    for (const item of items) gates.get(item)!.open();
    await done;
    expect(started).toEqual(items);
    expect(peak).toBe(2);
  });

  it("does not reject when a task throws", async () => {
    const ran: number[] = [];
    await expect(
      eachLimited([1, 2, 3], 2, async (item) => {
        ran.push(item);
        if (item === 1) throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
    expect(ran).toEqual([1, 2, 3]);
  });

  it("resolves on an empty list", async () => {
    let calls = 0;
    await eachLimited([], 3, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
