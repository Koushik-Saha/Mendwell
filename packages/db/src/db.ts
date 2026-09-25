import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Schema = typeof schema;

/** Works with both the Neon driver (production) and PGlite (tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
