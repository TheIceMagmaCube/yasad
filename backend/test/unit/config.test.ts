import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/config";

const valid = {
  AUTH_SECRET: "a".repeat(32),
  PUBLIC_URL: "https://yasad.example.org/",
};

function problemsOf(raw: Record<string, string | undefined>): string[] {
  try {
    loadConfig(raw);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe("loadConfig", () => {
  it("accepts a minimal configuration with defaults", () => {
    expect(loadConfig(valid)).toEqual({
      authSecret: "a".repeat(32),
      publicUrl: "https://yasad.example.org",
      setupCode: null,
      trustProxy: 0,
      sessionMaxAge: 604800,
      defaultLanguage: "en",
      passwordSignIn: true,
    });
  });

  it("reads the optional settings", () => {
    const config = loadConfig({ ...valid, SETUP_CODE: " " + "c".repeat(24) + " ", TRUST_PROXY: "true", SESSION_MAX_AGE: "3600" });
    expect(config).toMatchObject({ setupCode: "c".repeat(24), trustProxy: 1, sessionMaxAge: 3600 });
  });

  it("reads DEFAULT_LANGUAGE and rejects an unsupported one", () => {
    expect(loadConfig({ ...valid, DEFAULT_LANGUAGE: " FR " }).defaultLanguage).toBe("fr");
    expect(problemsOf({ ...valid, DEFAULT_LANGUAGE: "de" })).toEqual([expect.stringContaining("DEFAULT_LANGUAGE")]);
  });

  it("reads PASSWORD_SIGN_IN and rejects anything but true or false", () => {
    expect(loadConfig({ ...valid, PASSWORD_SIGN_IN: "False" }).passwordSignIn).toBe(false);
    expect(problemsOf({ ...valid, PASSWORD_SIGN_IN: "no" })).toEqual([expect.stringContaining("PASSWORD_SIGN_IN")]);
  });

  it("treats an empty SETUP_CODE as unset", () => {
    expect(loadConfig({ ...valid, SETUP_CODE: "" }).setupCode).toBeNull();
  });

  it("rejects a missing or short AUTH_SECRET", () => {
    expect(problemsOf({ PUBLIC_URL: valid.PUBLIC_URL })).toEqual([expect.stringContaining("AUTH_SECRET")]);
    expect(problemsOf({ ...valid, AUTH_SECRET: "short" })).toEqual([expect.stringContaining("AUTH_SECRET")]);
  });

  it("rejects a missing or non-http PUBLIC_URL", () => {
    expect(problemsOf({ AUTH_SECRET: valid.AUTH_SECRET })).toEqual([expect.stringContaining("PUBLIC_URL")]);
    expect(problemsOf({ ...valid, PUBLIC_URL: "ftp://x.org" })).toEqual([expect.stringContaining("PUBLIC_URL")]);
  });

  it("rejects a SETUP_CODE under 24 characters", () => {
    expect(problemsOf({ ...valid, SETUP_CODE: "1234" })).toEqual([expect.stringContaining("SETUP_CODE")]);
  });

  it("rejects a SESSION_MAX_AGE that is not a positive whole number", () => {
    for (const value of ["7d", "-1", "0", "1.5"]) {
      expect(problemsOf({ ...valid, SESSION_MAX_AGE: value })).toEqual([expect.stringContaining("SESSION_MAX_AGE")]);
    }
  });

  it("reads TRUST_PROXY as a number of proxies", () => {
    expect(loadConfig({ ...valid, TRUST_PROXY: "false" }).trustProxy).toBe(0);
    expect(loadConfig({ ...valid, TRUST_PROXY: "2" }).trustProxy).toBe(2);
    for (const value of ["yes", "-1", "1.5"]) {
      expect(problemsOf({ ...valid, TRUST_PROXY: value })).toEqual([expect.stringContaining("TRUST_PROXY")]);
    }
  });

  it("rejects the example secrets on an https URL", () => {
    const example = { AUTH_SECRET: "dev-only-secret-do-not-use-in-production", PUBLIC_URL: "https://portal.example.org" };
    expect(problemsOf(example)).toEqual([expect.stringContaining("AUTH_SECRET")]);
    expect(problemsOf({ ...valid, SETUP_CODE: "dev-only-setup-code-0123456789" })).toEqual([expect.stringContaining("SETUP_CODE")]);
    expect(problemsOf({ ...example, PUBLIC_URL: "http://localhost:5173" })).toEqual([]);
  });

  it("reports every problem at once", () => {
    expect(problemsOf({ SETUP_CODE: "x" })).toHaveLength(3);
  });
});
