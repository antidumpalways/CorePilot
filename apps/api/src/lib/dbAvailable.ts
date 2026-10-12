import { getPool } from "../db/client.js";

const CACHE_TTL_MS = 10_000;

let cached: { value: boolean; at: number } | undefined;

/** Returns whether the database is configured and reachable. Never throws. */
export async function dbAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const pool = getPool();
  if (!pool) return false;

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    cached = { value: true, at: now };
    return true;
  } catch {
    cached = { value: false, at: now };
    return false;
  }
}
