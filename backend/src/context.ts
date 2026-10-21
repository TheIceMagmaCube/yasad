import type { Auth, Session } from "./auth";
import type { Config } from "./config";
import type { DB } from "./db";

/** The target the app runs on, given by its entry (server.ts, worker.ts). */
export type Runtime = "docker" | "workers";

/** Per-request values set by the middleware in app.ts. */
export type AppEnv = {
  Variables: {
    db: DB;
    config: Config;
    clientIp: string;
    /** Set by app.ts from the entry's `runtime`; read by routes. */
    runtime: Runtime;
    auth?: Auth;
    /** The session read by `sessionFor`; unset until then. */
    session?: Session | null;
  };
};
