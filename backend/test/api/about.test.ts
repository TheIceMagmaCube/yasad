import { target, type TestApp, testApp } from "#harness";
import { describe, expect, it } from "vitest";

import { adminApp, errorOf } from "./catalog-items";
import { localUser } from "./home-catalog";
import { addUser, signIn } from "./users";

const REPOSITORY = "https://github.com/TheIceMagmaCube/yasad";
const SOURCE = { repository: REPOSITORY, tree: REPOSITORY, license: `${REPOSITORY}/blob/main/LICENSE` };

async function versionOf(app: TestApp): Promise<string> {
  return ((await (await app.request("/api/health")).json()) as { version: string }).version;
}

async function about(app: TestApp) {
  const res = await app.request("/api/about");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  return res;
}

describe("GET /api/about", () => {
  it("answers 401 without a session", async () => {
    const res = await (await testApp()).request("/api/about");
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthenticated");
  });

  it("gives a user the version and the source links only", async () => {
    const admin = await adminApp();
    const user = await localUser(admin, "bob");
    expect(await (await about(user)).json()).toEqual({ version: await versionOf(user), source: SOURCE });
  });

  it("never tells a user about the instance, even with a catalog file", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/srv/catalog.yaml" });
    const user = await localUser(admin, "bob");
    expect(await (await about(user)).json()).toEqual({ version: await versionOf(user), source: SOURCE });
  });

  it("tells an admin the runtime and whether the catalog file manages the catalog", async () => {
    const admin = await adminApp();
    expect(await (await about(admin)).json()).toEqual({
      version: await versionOf(admin),
      source: SOURCE,
      instance: { runtime: target === "workers" ? "workers" : "docker", catalogManagedByFile: false },
    });
  });

  it("says the catalog is managed by file without sending its path", async () => {
    const admin = await adminApp({ CATALOG_FILE: "/srv/catalog.yaml" });
    const text = await (await about(admin)).text();
    expect((JSON.parse(text) as { instance: { catalogManagedByFile: boolean } }).instance.catalogManagedByFile).toBe(true);
    expect(text).not.toContain("/srv/catalog.yaml");
    expect(text).not.toContain("catalog.yaml");
  });

  it("is refused while a temporary password is set", async () => {
    const app = await testApp();
    await addUser(app, { id: "tim", email: "tim@example.invalid", mustChangePassword: true });
    expect((await signIn(app, "tim@example.invalid")).status).toBe(200);
    const res = await app.request("/api/about");
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("password_change_required");
  });
});
