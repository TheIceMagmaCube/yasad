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
  export type { TestApp, TestEnv } from "./shared";
  export const target: "node" | "workers";
  export const BASE_ENV: { AUTH_SECRET: string; PUBLIC_URL: string };
  export const TEST_IP: string;
  export function testApp(env?: import("./shared").TestEnv): Promise<import("./shared").TestApp>;
  export function request(path: string, init?: RequestInit): Promise<Response>;
}
