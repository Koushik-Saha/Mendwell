import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Db } from "./db";
import * as schema from "./schema";

/**
 * Neon over WebSockets (Node 22+ has a global WebSocket). Supports interactive transactions,
 * which the HTTP driver doesn't. Use the pooled DATABASE_URL here.
 */
export function createDb(connectionString: string): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}
