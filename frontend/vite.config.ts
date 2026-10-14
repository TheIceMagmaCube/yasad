import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same origin as in production: the API is proxied, no CORS.
    proxy: { "/api": "http://localhost:3000" },
  },
});
