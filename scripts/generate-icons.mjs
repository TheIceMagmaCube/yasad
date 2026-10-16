/**
 * Generate the catalog icons from simple-icons and lucide-static.
 *
 * Writes one JSON file per icon under frontend/public/icons/<hash>/, where <hash> is a hash of the
 * generated content, plus a NOTICE.txt with the licences; frontend/src/icons-base.ts, the URL base
 * the frontend fetches icons from; and backend/src/icons/names.ts, the names the API and the import
 * accept. Only Simple Icons with no licence of their own (CC0 data), or under CC0, the Unlicense, CC-BY
 * or CC-BY-SA, are kept: the others need the full licence text and a copyright holder the data does
 * not give, or forbid commercial use or adaptation. Run with `--check` to only report whether the committed name lists are up to date.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = join(ROOT, "frontend/public/icons");
export const ICONS_BASE_FILE = join(ROOT, "frontend/src/icons-base.ts");
export const NAMES_FILE = join(ROOT, "backend/src/icons/names.ts");

const LUCIDE_TAGS = new Set(["path", "circle", "rect", "line", "ellipse", "polyline", "polygon"]);
const LUCIDE_ATTRIBUTES = new Set(["d", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "x1", "x2", "y1", "y2", "points", "fill"]);
const COMPLETE_MARKER = ".complete";

/** Return the parsed JSON file at `path`. */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Return the directory of an installed package. */
const packageDir = (name) => join(ROOT, "node_modules", name);

/** Return whether a Simple Icon is left out: any licence other than CC0, the Unlicense, CC-BY or CC-BY-SA. */
export function excludedLicense(license) {
  if (!license) return false;
  return !/^(CC0-1\.0|Unlicense|CC-BY-(SA-)?\d\.\d)$/.test(license.type);
}

/** Return the Simple Icons kept, sorted by slug, with their path and licence. */
function simpleIcons() {
  const dir = packageDir("simple-icons");
  const data = readJson(join(dir, "data/simple-icons.json"));
  const icons = Array.isArray(data) ? data : data.icons;
  return icons
    .filter((icon) => !excludedLicense(icon.license))
    .map((icon) => {
      const svg = readFileSync(join(dir, "icons", `${icon.slug}.svg`), "utf8");
      const path = svg.match(/<path d="([^"]+)"\s*\/>/)?.[1];
      if (!path) throw new Error(`simple-icons: no path in ${icon.slug}.svg`);
      return { slug: icon.slug, title: icon.title, source: icon.source, path, license: icon.license };
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** Return the icon nodes with only the allowed tags and attributes, all values as strings. */
function cleanNodes(name, nodes) {
  return nodes
    .filter(([tag]) => LUCIDE_TAGS.has(tag))
    .map(([tag, attributes]) => {
      const kept = Object.entries(attributes).filter(([key, value]) => LUCIDE_ATTRIBUTES.has(key) && typeof value === "string");
      if (kept.length === 0) throw new Error(`lucide-static: empty ${tag} in ${name}`);
      return [tag, Object.fromEntries(kept)];
    });
}

/** Return the Lucide icons by canonical name and the alias map, read from lucide-static. */
function lucideIcons() {
  const dir = packageDir("lucide-static");
  const nodes = readJson(join(dir, "icon-nodes.json"));
  const pascal = (name) =>
    name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  const exports = new Map();
  const index = readFileSync(join(dir, "dist/esm/lucide-static.mjs"), "utf8");
  for (const match of index.matchAll(/export \{([^}]*)\} from ['"]\.\/icons\/([a-z0-9-]+)\.mjs['"]/g)) {
    for (const part of match[1].split(",")) exports.set(part.trim().replace(/^default as /, ""), match[2]);
  }
  const aliases = {};
  for (const file of readdirSync(join(dir, "icons")).sort()) {
    const name = file.replace(/\.svg$/, "");
    if (!file.endsWith(".svg") || nodes[name]) continue;
    const canonical = exports.get(pascal(name));
    if (!canonical || !nodes[canonical]) throw new Error(`lucide-static: no canonical icon for alias ${name}`);
    aliases[name] = canonical;
  }
  const icons = Object.keys(nodes)
    .sort()
    .map((name) => ({ name, nodes: cleanNodes(name, nodes[name]) }));
  return { icons, aliases, license: readFileSync(join(dir, "LICENSE"), "utf8") };
}

/** Return the URL of a Simple Icons licence: its own URL when given, otherwise the SPDX page of its id. */
export function licenseUrl(license) {
  return license.url ?? `https://spdx.org/licenses/${license.type}.html`;
}

/** Return the NOTICE.txt text: the Lucide licence and the Simple Icons kept under their own licence. */
function notice(si, lucide, versions) {
  const ownLicense = si.filter((icon) => icon.license);
  return [
    "Icons served by YASAD",
    "",
    `Lucide (lucide-static ${versions.lucide}), https://lucide.dev`,
    "",
    lucide.license.trim(),
    "",
    "---",
    "",
    `Simple Icons (simple-icons ${versions.si}), https://simpleicons.org`,
    "",
    "The Simple Icons data is released under CC0-1.0. The logos are trademarks of their owners; showing",
    "one identifies the linked service and implies no endorsement. See the Simple Icons DISCLAIMER:",
    "https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md",
    "",
    "Icons under their own licence, with the source of each logo and a link to the full text of its licence:",
    "",
    ...ownLicense.flatMap((icon) => [
      `${icon.slug} (${icon.title})`,
      `  Source: ${icon.source}`,
      `  Licence: ${icon.license.type}, ${licenseUrl(icon.license)}`,
      "",
    ]),
  ].join("\n");
}

/** Return the TypeScript source of a set of strings, one per line. */
const setSource = (name, values) => `export const ${name} = new Set<string>([\n${values.map((v) => `  ${JSON.stringify(v)},`).join("\n")}\n]);\n`;

/**
 * Return every generated output, in memory.
 *
 * `files` maps a path relative to the hash directory to its content; `hash` names that directory.
 */
export function buildIcons() {
  const versions = {
    si: readJson(join(packageDir("simple-icons"), "package.json")).version,
    lucide: readJson(join(packageDir("lucide-static"), "package.json")).version,
  };
  const si = simpleIcons();
  const lucide = lucideIcons();

  const files = new Map();
  for (const icon of si) files.set(`si/${icon.slug}.json`, JSON.stringify({ path: icon.path }));
  for (const icon of lucide.icons) files.set(`lucide/${icon.name}.json`, JSON.stringify({ nodes: icon.nodes }));
  files.set("NOTICE.txt", notice(si, lucide, versions));

  const digest = createHash("sha256");
  for (const [path, content] of files) digest.update(`${path}\0${content}\0`);
  const hash = digest.digest("hex").slice(0, 12);

  const banner = `/** Generated by scripts/generate-icons.mjs from simple-icons ${versions.si} and lucide-static ${versions.lucide}. Do not edit. */\n`;
  const iconsBase = `${banner}export const ICONS_BASE = "/icons/${hash}";\n`;
  const aliasLines = Object.entries(lucide.aliases).map(([alias, name]) => `  ${JSON.stringify(alias)}: ${JSON.stringify(name)},`);
  const names = [
    banner,
    "/** Simple Icons slugs, licence filter applied. */\n",
    setSource("SI", si.map((icon) => icon.slug)),
    "\n/** Canonical Lucide names. */\n",
    setSource("LUCIDE", lucide.icons.map((icon) => icon.name)),
    "\n/** Lucide aliases, each mapped to its canonical name. */\n",
    `export const LUCIDE_ALIASES: Record<string, string> = {\n${aliasLines.join("\n")}\n};\n`,
  ].join("");
  return { hash, files, iconsBase, names, versions };
}

/** Write a file only when its content changes, creating its directory. */
function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Write every output; the icon directory is rewritten only when its hash changes. */
export function writeIcons() {
  const out = buildIcons();
  const dir = join(PUBLIC_DIR, out.hash);
  if (!existsSync(join(dir, COMPLETE_MARKER))) {
    rmSync(PUBLIC_DIR, { recursive: true, force: true });
    for (const [path, content] of out.files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    writeFileSync(join(dir, COMPLETE_MARKER), "");
  }
  writeIfChanged(ICONS_BASE_FILE, out.iconsBase);
  writeIfChanged(NAMES_FILE, out.names);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const out = buildIcons();
    const stale = [
      [ICONS_BASE_FILE, out.iconsBase],
      [NAMES_FILE, out.names],
    ].filter(([path, content]) => !existsSync(path) || readFileSync(path, "utf8") !== content);
    for (const [path] of stale) console.error(`${path} is out of date: run node scripts/generate-icons.mjs and commit it.`);
    process.exit(stale.length > 0 ? 1 : 0);
  }
  const out = writeIcons();
  console.log(`Icons: ${out.files.size - 1} files in frontend/public/icons/${out.hash}/`);
}
