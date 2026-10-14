// Replaced at build time (esbuild for Docker, `wrangler deploy --define` for Workers).
// The released version lives in git tags, not in package.json.
declare const __APP_VERSION__: string | undefined;

export const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
