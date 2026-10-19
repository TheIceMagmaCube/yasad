import { describe, expect, it } from "vitest";

import { adminRoute, canonicalAdminPath } from "./AdminRoutes";

describe("canonicalAdminPath", () => {
  it("opens /admin on people, the former groups list on the people table, the former catalog page on the YAML file", () => {
    expect(canonicalAdminPath("/admin")).toBe("/admin/users");
    expect(canonicalAdminPath("/admin/groups")).toBe("/admin/users");
    expect(canonicalAdminPath("/admin/groups/g1")).toBe("/admin/groups/g1");
    expect(canonicalAdminPath("/admin/catalog")).toBe("/admin/links/file");
    expect(canonicalAdminPath("/admin/links")).toBe("/admin/links");
  });
});

describe("adminRoute", () => {
  it("routes the people table, a person, a group and the wizard adding either", () => {
    expect(adminRoute("/admin/users")).toEqual({ section: "users", open: null });
    expect(adminRoute("/admin/users/new")).toEqual({ section: "users", open: { kind: "new", type: "person" } });
    expect(adminRoute("/admin/users/u%201")).toEqual({ section: "users", open: { kind: "person", id: "u 1" } });
    expect(adminRoute("/admin/groups/new")).toEqual({ section: "users", open: { kind: "new", type: "group" } });
    expect(adminRoute("/admin/groups/system%3Aeveryone")).toEqual({ section: "users", open: { kind: "group", id: "system:everyone" } });
  });

  it("routes the links list, a link, a category, the YAML file and the wizard adding a link or a category", () => {
    expect(adminRoute("/admin/links")).toEqual({ section: "links", open: null });
    expect(adminRoute("/admin/links/new")).toEqual({ section: "links", open: { kind: "new", type: "link" } });
    expect(adminRoute("/admin/links/wiki")).toEqual({ section: "links", open: { kind: "link", id: "wiki" } });
    expect(adminRoute("/admin/links/categories/new")).toEqual({ section: "links", open: { kind: "new", type: "category" } });
    expect(adminRoute("/admin/links/categories/dev-tools")).toEqual({ section: "links", open: { kind: "category", id: "dev-tools" } });
    expect(adminRoute("/admin/links/file")).toEqual({ section: "links-file" });
  });

  it("opens nothing for an unknown or too deep address, or a broken escape", () => {
    const paths = ["/admin/nowhere", "/admin/users/a/b", "/admin/catalog", "/admin/catalog/x", "/admin/groups", "/admin/users/%E0"];
    for (const path of [...paths, "/admin/links/wiki/x", "/admin/links/categories", "/admin/links/categories/a/b", "/admin/links/file/x", "/admin/links/%E0"]) {
      expect(adminRoute(path)).toBeNull();
    }
  });
});
