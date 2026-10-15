export type TestEnv = Record<string, string | undefined>;

export type TestApp = {
  /** Send a request with Origin, CF-Connecting-IP and the cookies received so far. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Run one SQL statement directly on the database. */
  exec(sql: string): Promise<void>;
  /** Run one SQL query directly on the database and return its rows. */
  query(sql: string): Promise<Record<string, unknown>[]>;
  /** Return another client on the same database, with no cookies: a second browser. */
  another(): TestApp;
};

export const BASE_ENV = {
  AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  PUBLIC_URL: "https://yasad.test",
};

export const TEST_IP = "203.0.113.10";

/** Return a test client that keeps cookies between requests, like a browser. */
export function client(
  fetch: (req: Request) => Promise<Response>,
  exec: (sql: string) => Promise<void>,
  query: (sql: string) => Promise<Record<string, unknown>[]>,
): TestApp {
  const jar = new Map<string, string>();
  return {
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("origin")) headers.set("origin", BASE_ENV.PUBLIC_URL);
      if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", TEST_IP);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));

      const res = await fetch(new Request(new URL(path, BASE_ENV.PUBLIC_URL), { ...init, headers }));
      for (const cookie of res.headers.getSetCookie()) {
        const pair = cookie.split(";")[0]!;
        const name = pair.slice(0, pair.indexOf("="));
        const value = pair.slice(pair.indexOf("=") + 1);
        if (value === "" || /max-age=0/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
    exec,
    query,
    another: () => client(fetch, exec, query),
  };
}
