import { describe, expect, it } from "vitest";

import { adminRoute, canonicalAdminPath } from "./AdminRoutes";

describe("canonicalAdminPath", () => {
  it("keeps /admin for the dashboard, opens the former groups list on the people table, the former catalog page on the YAML file", () => {
    expect(canonicalAdminPath("/admin")).toBe("/admin");
    expect(canonicalAdminPath("/admin/groups")).toBe("/admin/users");
    expect(canonicalAdminPath("/admin/groups/g1")).toBe("/admin/groups/g1");
    expect(canonicalAdminPath("/admin/catalog")).toBe("/admin/links/file");
    expect(canonicalAdminPath("/admin/links")).toBe("/admin/links");
  });
});

describe("adminRoute", () => {
  it("routes the dashboard, the people table, a person, a group and the wizard adding either", () => {
    expect(adminRoute("/admin")).toEqual({ section: "dashboard" });
    expect(adminRoute("/admin/users")).toEqual({ section: "users", open: null });
    expect(adminRoute("/admin/users/new")).toEqual({ section: "users", open: { kind: "new", type: "person" } });
    expect(adminRoute("/admin/users/u%201")).toEqual({ section: "users", open: { kind: "person", id: "u 1" } });
    expect(adminRoute("/admin/groups/new")).toEqual({ section: "users", open: { kind: "new", type: "group" } });
    expect(adminRoute("/admin/groups/system%3Aeveryone")).toEqual({ section: "users", open: { kind: "group", id: "system:everyone" } });
  });

  it("routes the preview of a person's home page, and no other third segment", () => {
    expect(adminRoute("/admin/users/u%201/home")).toEqual({ section: "users", open: { kind: "preview", id: "u 1" } });
    for (const path of ["/admin/users/u1/edit", "/admin/users/new/home", "/admin/users/u1/home/x", "/admin/groups/g1/home"]) {
      expect(adminRoute(path)).toBeNull();
    }
  });

  it("routes the links list, a link, a category, the YAML file and the wizard adding a link or a category", () => {
    expect(adminRoute("/admin/links")).toEqual({ section: "links", open: null });
    expect(adminRoute("/admin/links/new")).toEqual({ section: "links", open: { kind: "new", type: "link" } });
    expect(adminRoute("/admin/links/wiki")).toEqual({ section: "links", open: { kind: "link", id: "wiki" } });
    expect(adminRoute("/admin/links/categories/new")).toEqual({ section: "links", open: { kind: "new", type: "category" } });
    expect(adminRoute("/admin/links/categories/dev-tools")).toEqual({ section: "links", open: { kind: "category", id: "dev-tools" } });
    expect(adminRoute("/admin/links/file")).toEqual({ section: "links-file" });
    expect(adminRoute("/admin/links/visitor/home")).toEqual({ section: "links", open: { kind: "visitor" } });
    expect(adminRoute("/admin/links/visitor")).toEqual({ section: "links", open: { kind: "link", id: "visitor" } });
  });

  it("routes the history, its filters left to the query", () => {
    expect(adminRoute("/admin/history")).toEqual({ section: "history" });
    expect(adminRoute("/admin/history/x")).toBeNull();
  });

  it("opens nothing for an unknown or too deep address, or a broken escape", () => {
    const paths = ["/admin/nowhere", "/admin/users/a/b", "/admin/catalog", "/admin/catalog/x", "/admin/groups", "/admin/users/%E0"];
    for (const path of [...paths, "/admin/links/wiki/x", "/admin/links/categories", "/admin/links/categories/a/b", "/admin/links/file/x", "/admin/links/visitor/x", "/admin/links/visitor/home/x", "/admin/links/%E0"]) {
      expect(adminRoute(path)).toBeNull();
    }
  });
});
