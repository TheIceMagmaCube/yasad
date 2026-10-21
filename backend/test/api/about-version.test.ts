import { target } from "#harness";
import { describe, expect, it, vi } from "vitest";

// A build of a beta commit: the API tests otherwise run with version "dev", whose links point to the repository.
vi.mock("../../src/version", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/version")>()),
  version: "0.2.0-6-gac6136b",
}));

const { adminApp } = await import("./catalog-items");
const { localUser } = await import("./home-catalog");

const REPOSITORY = "https://github.com/TheIceMagmaCube/yasad";

// Node only: under workerd, src/worker.ts is the Worker's main module, loaded before this file's mock applies.
// The route is the same code on both targets; the Worker's version itself comes from `wrangler deploy --define`.
describe.skipIf(target === "workers")("GET /api/about with a build version", () => {
  it("links the exact tree and LICENSE of that build", async () => {
    const user = await localUser(await adminApp(), "bob");
    const res = await user.request("/api/about");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: "0.2.0-6-gac6136b",
      source: {
        repository: REPOSITORY,
        tree: `${REPOSITORY}/tree/ac6136b`,
        license: `${REPOSITORY}/blob/ac6136b/LICENSE`,
      },
    });
  });
});
