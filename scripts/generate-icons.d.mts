/** Types of generate-icons.mjs, for the tests that import it. */
export const ROOT: string;
export const PUBLIC_DIR: string;
export const ICONS_BASE_FILE: string;
export const NAMES_FILE: string;

export type GeneratedIcons = {
  /** Names the directory the files are served from: `/icons/<hash>/`. */
  hash: string;
  /** Content by path relative to that directory, such as `si/github.json`. */
  files: Map<string, string>;
  iconsBase: string;
  names: string;
  versions: { si: string; lucide: string };
};

export function excludedLicense(license: { type: string; url?: string } | undefined): boolean;
export function buildIcons(): GeneratedIcons;
export function writeIcons(): GeneratedIcons;
