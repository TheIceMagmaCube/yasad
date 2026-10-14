import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type * as schema from "./schema";

// Shared shape of the D1 (Workers) and libSQL (Docker) Drizzle clients: both are async SQLite.
// `batch` exists on both and runs its statements as one transaction.
export type DB = BaseSQLiteDatabase<"async", unknown, typeof schema> & {
  batch: (queries: readonly [unknown, ...unknown[]]) => Promise<unknown[]>;
};
