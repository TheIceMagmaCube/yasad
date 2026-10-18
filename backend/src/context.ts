import type { Auth, Session } from "./auth";
import type { Config } from "./config";
import type { DB } from "./db";

/** Per-request values set by the middleware in app.ts. */
export type AppEnv = {
  Variables: {
    db: DB;
    config: Config;
    clientIp: string;
    auth?: Auth;
    /** The session read by `sessionFor`; unset until then. */
    session?: Session | null;
  };
};
