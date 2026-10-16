import { describe, expect, it } from "vitest";

import { withTombstones } from "./admin-list";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
const kinds = (entries: ReturnType<typeof withTombstones>) => entries.map((e) => (e.kind === "item" ? e.item.id : `+${e.tombstone.id}`));

describe("withTombstones", () => {
  it("replaces a row still listed by its message, in place", () => {
    expect(kinds(withTombstones(items, [{ id: "b", text: "gone", variant: "success", index: 1 }]))).toEqual(["a", "+b", "c"]);
  });

  it("puts back the message of a row the list no longer has where the row was", () => {
    const reloaded = items.filter((i) => i.id !== "b");
    expect(kinds(withTombstones(reloaded, [{ id: "b", text: "gone", variant: "success", index: 1 }]))).toEqual(["a", "+b", "c"]);
  });

  it("keeps a message at the end when the list got shorter than its index", () => {
    expect(kinds(withTombstones([{ id: "a" }], [{ id: "z", text: "gone", variant: "destructive", index: 5 }]))).toEqual(["a", "+z"]);
  });
});
