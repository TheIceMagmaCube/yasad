import { testApp } from "#harness";
import { describe, expect, it } from "vitest";

describe("GET /api/instance", () => {
  it("returns the defaults on a fresh instance", async () => {
    const res = await (await testApp()).request("/api/instance");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: null });
  });

  it("returns the stored title, logo and theme, and DEFAULT_LANGUAGE", async () => {
    const app = await testApp({ DEFAULT_LANGUAGE: "fr", PASSWORD_SIGN_IN: "false" });
    await app.exec(
      "insert into setting (key, value) values ('instance.title', 'Home lab'), ('instance.logo', '/logo.svg'), ('instance.theme', 'dusk')",
    );
    expect(await (await app.request("/api/instance")).json()).toEqual({
      title: "Home lab",
      logo: "/logo.svg",
      theme: "dusk",
      defaultLanguage: "fr",
      passwordSignIn: false,
      oidc: null,
    });
  });

  it("falls back to the defaults on values the page cannot use", async () => {
    const app = await testApp();
    await app.exec(
      "insert into setting (key, value) values ('instance.title', '  '), ('instance.logo', 'https://cdn.example/logo.png'), ('instance.theme', 'neon')",
    );
    expect(await (await app.request("/api/instance")).json()).toMatchObject({ title: "YASAD", logo: null, theme: "default" });
  });

  it("is public", async () => {
    const res = await (await testApp()).request("/api/instance", { headers: { origin: "" } });
    expect(res.status).toBe(200);
  });
});
