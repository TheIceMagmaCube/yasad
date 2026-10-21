// Replaced at build time (esbuild for Docker, `npm run deploy:worker`, i.e. `wrangler deploy --define`, for Workers).
// The released version lives in git tags, not in package.json.
declare const __APP_VERSION__: string | undefined;

export const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** The public repository of YASAD: the one address to change in a fork. */
export const SOURCE_REPOSITORY = "https://github.com/TheIceMagmaCube/yasad";

const DESCRIBE = /^\d+\.\d+\.\d+(?:-beta\.\d+)?-\d+-g([0-9a-f]{7,40})$/;
const SHA = /^[0-9a-f]{7,40}$/;
const RELEASE = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

/**
 * Return the git reference of the source matching a build version: the commit for `git describe` output
 * (`X.Y.Z[-beta.N]-K-g<sha>`) or a bare 7-40 hex sha, the tag `vX.Y.Z[-beta.N]` for a release, null otherwise.
 */
export function sourceRefOf(version: string): string | null {
  const described = DESCRIBE.exec(version);
  if (described) return described[1] ?? null;
  if (SHA.test(version)) return version;
  if (RELEASE.test(version)) return `v${version}`;
  return null;
}

export type SourceLinks = { repository: string; tree: string; license: string };

/** Return the repository, the tree at `sourceRefOf(version)` (the repository when null) and its LICENSE (main when null). */
export function sourceLinksOf(version: string): SourceLinks {
  const ref = sourceRefOf(version);
  return {
    repository: SOURCE_REPOSITORY,
    tree: ref === null ? SOURCE_REPOSITORY : `${SOURCE_REPOSITORY}/tree/${ref}`,
    license: `${SOURCE_REPOSITORY}/blob/${ref ?? "main"}/LICENSE`,
  };
}
