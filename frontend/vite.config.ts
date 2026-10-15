import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Mark the dev server's page so public/theme-init.js honours the dev theme override. */
const markDev: Plugin = {
  name: "yasad-mark-dev",
  apply: "serve",
  transformIndexHtml: (html) => html.replace("<html ", "<html data-dev "),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), markDev],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // Same origin as in production: the API is proxied, no CORS.
    proxy: { "/api": "http://localhost:3000" },
  },
});
