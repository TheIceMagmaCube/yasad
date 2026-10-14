import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files may run several times; only pending migrations are applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
