import { describe, expect, it } from "vitest";

describe("docs/catalog.example.yaml", () => {
  it("is a valid catalog", async () => {
    const { readFile } = await import("node:fs/promises");
    const { parseCatalog } = await import("../../src/catalog/format");
    const parsed = parseCatalog(await readFile(new URL("../../../docs/catalog.example.yaml", import.meta.url), "utf8"));
    expect(parsed.ok ? [] : parsed.errors).toEqual([]);
  });
});
