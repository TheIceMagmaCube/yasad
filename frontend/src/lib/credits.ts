import { ICONS_BASE } from "../icons-base";

/**
 * A font or icon set shipped in the frontend. Names and licences are not translated. `package` is the npm package
 * of the frontend it comes from, null when the files are vendored or come from a root devDependency.
 */
export type Credit = { id: string; name: string; url: string; /** SPDX id */ license: string; package: string | null };

/** The self-hosted fonts; a new `@fontsource-variable/*` dependency needs an entry (credits.test.ts checks it). */
export const FONT_CREDITS: readonly Credit[] = [
  { id: "inter", name: "Inter", url: "https://github.com/rsms/inter", license: "OFL-1.1", package: "@fontsource-variable/inter" },
  {
    id: "bricolage-grotesque",
    name: "Bricolage Grotesque",
    url: "https://github.com/ateliertriay/bricolage",
    license: "OFL-1.1",
    package: "@fontsource-variable/bricolage-grotesque",
  },
  { id: "azeret-mono", name: "Azeret Mono", url: "https://github.com/displaay/azeret", license: "OFL-1.1", package: "@fontsource-variable/azeret-mono" },
  {
    id: "pixelify-sans",
    name: "Pixelify Sans",
    url: "https://github.com/eifetx/Pixelify-Sans",
    license: "OFL-1.1",
    package: "@fontsource-variable/pixelify-sans",
  },
  // Vendored in src/fonts/ with its licence: the Fontsource build drops its colour tables.
  { id: "nabla", name: "Nabla", url: "https://github.com/justvanrossum/nabla", license: "OFL-1.1", package: null },
];

/** The icon sets: Lucide for the interface and the catalog, Simple Icons (generated at build time) for the catalog. */
export const ICON_CREDITS: readonly Credit[] = [
  { id: "lucide", name: "Lucide", url: "https://lucide.dev", license: "ISC", package: "lucide-react" },
  // A root devDependency read by scripts/generate-icons.mjs, not a frontend package.
  { id: "simple-icons", name: "Simple Icons", url: "https://simpleicons.org", license: "CC0-1.0", package: null },
];

/** Full names of the font licences, shown as written (English). */
export const LICENSE_NAMES: Record<string, string> = {
  "OFL-1.1": "SIL Open Font License 1.1",
};

/** The licences of the icons served, written by scripts/generate-icons.mjs next to them. */
export const ICON_NOTICE = `${ICONS_BASE}/NOTICE.txt`;
