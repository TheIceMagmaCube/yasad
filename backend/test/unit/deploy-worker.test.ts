import { describe, expect, it, vi } from "vitest";

import { sourceRefOf } from "../../src/version";

const spawned = vi.hoisted(() => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:child_process", () => spawned);

const { deployArgs, versionOf } = await import("../../scripts/deploy-worker.mjs");

describe("deploy-worker", () => {
  it("does not run git or wrangler when imported", () => {
    expect(spawned.execFileSync).not.toHaveBeenCalled();
    expect(spawned.spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    ["v0.2.0-6-gac6136b\n", "0.2.0-6-gac6136b"],
    ["v0.1.1-beta.1-2-gdeadbee\n", "0.1.1-beta.1-2-gdeadbee"],
    ["ac6136b\n", "ac6136b"],
    ["v0.2.0", "0.2.0"],
    [null, "dev"],
    ["", "dev"],
    ["\n", "dev"],
  ])("reads the version of %j as %j", (describe, version) => {
    expect(versionOf(describe)).toBe(version);
  });

  it.each(["v0.2.0-6-gac6136b\n", "v0.1.1-beta.1-2-gdeadbee\n", "ac6136b\n", "v0.2.0", "v0.1.1-beta.1"])(
    "gives a version with a source reference for %j",
    (describe) => {
      expect(sourceRefOf(versionOf(describe))).not.toBeNull();
    },
  );

  it("passes the version as a JSON string define, then the caller's arguments", () => {
    expect(deployArgs("0.2.0", ["--config", "wrangler.prod.jsonc"])).toEqual([
      "deploy",
      "--define",
      '__APP_VERSION__:"0.2.0"',
      "--config",
      "wrangler.prod.jsonc",
    ]);
  });
});
