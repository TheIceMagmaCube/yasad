import { describe, expect, it } from "vitest";

import { SOURCE_REPOSITORY, sourceLinksOf, sourceRefOf } from "../../src/version";

const R = "https://github.com/TheIceMagmaCube/yasad";

describe("sourceRefOf", () => {
  it.each([
    ["0.2.0", "v0.2.0"],
    ["0.1.1-beta.1", "v0.1.1-beta.1"],
    ["0.2.0-6-gac6136b", "ac6136b"],
    ["0.1.1-beta.1-2-gdeadbee", "deadbee"],
    ["ac6136b", "ac6136b"],
  ])("maps %s to %s", (version, ref) => {
    expect(sourceRefOf(version)).toBe(ref);
  });

  it.each(["dev", "0.1.0-beta.abc1234", "0.2.0/../x", "0.2.0?x=1", ""])("gives null for %j", (version) => {
    expect(sourceRefOf(version)).toBeNull();
  });
});

describe("sourceLinksOf", () => {
  it("points at the repository and main without a reference", () => {
    expect(SOURCE_REPOSITORY).toBe(R);
    expect(sourceLinksOf("dev")).toEqual({ repository: R, tree: R, license: `${R}/blob/main/LICENSE` });
  });

  it("points at the commit of a git describe version", () => {
    expect(sourceLinksOf("0.2.0-6-gac6136b")).toEqual({
      repository: R,
      tree: `${R}/tree/ac6136b`,
      license: `${R}/blob/ac6136b/LICENSE`,
    });
  });
});
