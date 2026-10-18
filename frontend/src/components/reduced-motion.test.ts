// Paths are relative to the frontend workspace, where Vitest runs.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Return the component and page sources, tests excluded. */
async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return Promise.resolve(/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

// A class token that animates or transitions, with its variants.
const MOTION = /(?<![\w-])((?:[\w-]+:)*)(animate-(?!none\b)[\w-]+|transition(?:-[\w[\],-]+)?)(?![\w-])/g;

describe("reduced motion", () => {
  it("guards every animation and transition utility in the components and pages", async () => {
    const offenders: string[] = [];
    for (const file of [...(await sources("src/components")), ...(await sources("src/pages"))]) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const [token, variants, utility] of line.matchAll(MOTION)) {
          if (variants!.includes("motion-safe:") || variants!.includes("motion-reduce:")) continue;
          const stop = utility!.startsWith("animate-") ? "motion-reduce:animate-none" : "motion-reduce:transition-none";
          if (!line.includes(stop)) offenders.push(`${file}:${i + 1} ${token}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
