import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { db, transaction, closeDb } from "../src/server/db";
export async function migrate() {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(82734621)");
      if (
        (
          await tx.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rows.length
      )
        return;
      const sql = await readFile("migrations/" + name, "utf8"); // pg supports multi-statement queries without parameters; PGlite needs exec.
      for (const statement of sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    });
    console.log("Applied", name);
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) migrate().finally(closeDb);
