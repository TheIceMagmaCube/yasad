/** Types of deploy-worker.mjs, for the tests that import it. */
export function versionOf(describe: string | null): string;
export function deployArgs(version: string, extra: readonly string[]): string[];
export function main(extra: readonly string[]): number;
