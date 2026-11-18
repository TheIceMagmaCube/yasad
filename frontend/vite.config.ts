import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { createMockApi } from "./mock/api";

/** Return the JSON body of a request, or an empty object. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Answer /api from memory instead of the backend, for clicking through the admin prototype without a server. */
function mockApi(): Plugin {
  return {
    name: "yasad-mock-api",
    configureServer(server) {
      const api = createMockApi();
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const answer = api.handle(req.method ?? "GET", new URL(req.url, "http://mock").pathname, await readBody(req));
        if (!answer) return next();
        res.statusCode = answer.status;
        if (answer.body === undefined) return res.end();
        res.setHeader("content-type", answer.type ?? "application/json");
        res.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
      });
    },
  };
}

const mock = process.env.YASAD_MOCK === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), mock && mockApi()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // Same origin as in production: the API is proxied, no CORS. YASAD_MOCK=1 answers it from memory instead.
    proxy: mock ? undefined : { "/api": "http://localhost:3000" },
  },
});
