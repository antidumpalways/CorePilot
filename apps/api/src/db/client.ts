import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Database | undefined;

/**
 * Lazily create the pg Pool. Returns undefined when DATABASE_URL is not set,
 * so importing this module never throws at startup.
 */
export function getPool(): Pool | undefined {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  pool = new Pool({ connectionString });
  return pool;
}

/** Lazily create the Drizzle client. Returns undefined when DB is not configured. */
export function getDb(): Database | undefined {
  if (db) return db;
  const existingPool = getPool();
  if (!existingPool) return undefined;
  db = drizzle(existingPool, { schema });
  return db;
}

export { schema };
