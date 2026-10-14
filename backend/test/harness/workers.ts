// Workers harness: the real Worker entry, running in workerd with a local D1 database.
import { exports } from "cloudflare:workers";

export const target = "workers";

export function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new URL(path, "https://yasad.test"), init);
}
