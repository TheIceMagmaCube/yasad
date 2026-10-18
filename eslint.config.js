import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "**/dist-worker/", "**/.wrangler/", "**/node_modules/", "backend/drizzle/", "backend/src/icons/names.ts", "frontend/public/icons/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["frontend/public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    files: ["frontend/e2e/**/*.ts", "frontend/*.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["backend/**/*.{ts,mjs}", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
