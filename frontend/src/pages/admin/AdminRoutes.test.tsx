import { describe, expect, it } from "vitest";

import { adminRoute, canonicalAdminPath } from "./AdminRoutes";

describe("canonicalAdminPath", () => {
  it("opens /admin on people, and the former groups list on the people table", () => {
    expect(canonicalAdminPath("/admin")).toBe("/admin/users");
    expect(canonicalAdminPath("/admin/groups")).toBe("/admin/users");
    expect(canonicalAdminPath("/admin/groups/g1")).toBe("/admin/groups/g1");
    expect(canonicalAdminPath("/admin/catalog")).toBe("/admin/catalog");
  });
});

describe("adminRoute", () => {
  it("routes the people table, a person, a group and the wizard adding either", () => {
    expect(adminRoute("/admin/users")).toEqual({ section: "users", open: null });
    expect(adminRoute("/admin/users/new")).toEqual({ section: "users", open: { kind: "new", type: "person" } });
    expect(adminRoute("/admin/users/u%201")).toEqual({ section: "users", open: { kind: "person", id: "u 1" } });
    expect(adminRoute("/admin/groups/new")).toEqual({ section: "users", open: { kind: "new", type: "group" } });
    expect(adminRoute("/admin/groups/system%3Aeveryone")).toEqual({ section: "users", open: { kind: "group", id: "system:everyone" } });
    expect(adminRoute("/admin/catalog")).toEqual({ section: "catalog" });
  });

  it("opens nothing for an unknown or too deep address, or a broken escape", () => {
    for (const path of ["/admin/nowhere", "/admin/users/a/b", "/admin/catalog/x", "/admin/groups", "/admin/users/%E0"]) {
      expect(adminRoute(path)).toBeNull();
    }
  });
});
