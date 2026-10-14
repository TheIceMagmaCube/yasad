declare namespace Cloudflare {
  // Types `exports.default` from "cloudflare:workers" as the Worker entry.
  interface GlobalProps {
    mainModule: typeof import("../../src/worker");
  }
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

declare module "#harness" {
  export const target: "node" | "workers";
  export function request(path: string, init?: RequestInit): Promise<Response>;
}
