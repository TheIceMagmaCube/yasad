import { afterEach, describe, expect, it, vi } from "vitest";

import { sourceRefOf } from "../../src/version";

const spawned = vi.hoisted(() => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:child_process", () => spawned);

const { deployArgs, main, versionOf } = await import("../../scripts/deploy-worker.mjs");

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

  describe("main", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      spawned.execFileSync.mockReset();
      spawned.spawnSync.mockReset();
    });

    it("runs wrangler without a shell, with the define and the caller's arguments, and returns its status", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      spawned.execFileSync.mockReturnValue("v0.2.0-6-gac6136b\n");
      spawned.spawnSync.mockReturnValue({ status: 3 });
      expect(main(["--config", "wrangler.prod.jsonc"])).toBe(3);
      expect(spawned.spawnSync).toHaveBeenCalledTimes(1);
      expect(spawned.spawnSync).toHaveBeenCalledWith(
        "wrangler",
        ["deploy", "--define", '__APP_VERSION__:"0.2.0-6-gac6136b"', "--config", "wrangler.prod.jsonc"],
        { stdio: "inherit" },
      );
    });

    it("returns 1 when wrangler did not run", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      spawned.execFileSync.mockImplementation(() => {
        throw new Error("not a git checkout");
      });
      spawned.spawnSync.mockReturnValue({ status: null, error: new Error("spawn wrangler ENOENT") });
      expect(main([])).toBe(1);
      expect(spawned.spawnSync.mock.calls[0]?.[1]).toEqual(["deploy", "--define", '__APP_VERSION__:"dev"']);
    });
  });
});
