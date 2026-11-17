import { attachDatabasePool } from "@vercel/functions";
import { mkdirSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { PGlite } from "@electric-sql/pglite";
export type DB = {
  query<T extends Record<string, any> = Record<string, any>>(
    text: string,
    values?: any[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};
const g = globalThis as typeof globalThis & {
  pool?: Pool;
  lite?: PGlite;
  queue?: Promise<unknown>;
};
export function localMode() {
  return (
    process.env.LOCAL_DATABASE === "1" &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production"
  );
}
function lite() {
  if (!g.lite) {
    const path = process.env.LOCAL_DATABASE_PATH || ".local/db";
    if (!path.startsWith("memory://")) mkdirSync(path, { recursive: true });
    g.lite = new PGlite(path);
  }
  return g.lite;
}
function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
  if (!g.pool) {
    g.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    if (process.env.VERCEL) attachDatabasePool(g.pool);
  }
  return g.pool;
}
export const db: DB = {
  async query(text, values = []) {
    if (localMode()) {
      await (g.queue ?? Promise.resolve());
      return await lite()
        .query(text, values)
        .then((r) => ({
          rows: r.rows as any[],
          rowCount: r.affectedRows ?? r.rows.length,
        }));
    }
    return pool().query(text, values);
  },
};
export async function transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
  if (localMode()) {
    const previous = g.queue ?? Promise.resolve();
    let release!: () => void;
    g.queue = new Promise<void>((r) => (release = r));
    await previous;
    try {
      return await lite().transaction(async (tx) =>
        fn({
          async query(text, values = []) {
            const r = await tx.query(text, values);
            return {
              rows: r.rows as any[],
              rowCount: r.affectedRows ?? r.rows.length,
            };
          },
        }),
      );
    } finally {
      release();
    }
  }
  const client: PoolClient = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function closeDb() {
  await g.pool?.end();
  await g.lite?.close();
  g.pool = undefined;
  g.lite = undefined;
}
