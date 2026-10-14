import { request } from "#harness";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("reports the version and a reachable database", async () => {
    const res = await request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, database: true, version: expect.any(String) });
  });

  it("answers 404 outside known routes", async () => {
    const res = await request("/api/nope");
    expect(res.status).toBe(404);
  });
});
