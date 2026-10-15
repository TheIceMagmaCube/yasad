import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { headersFile } from "../../src/security";

describe("frontend/public/_headers", () => {
  it("matches the headers sent by the app, so the Worker's static assets get them too", async () => {
    const file = await readFile(new URL("../../../frontend/public/_headers", import.meta.url), "utf8");
    expect(file).toBe(headersFile());
  });
});
