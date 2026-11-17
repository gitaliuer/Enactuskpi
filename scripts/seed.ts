import "dotenv/config";
import { db, transaction, closeDb } from "../src/server/db";
import { id } from "../src/server/core";
if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL ||
  process.env.SEED_TEST_DATA !== "yes"
)
  throw new Error(
    "Test data only: set SEED_TEST_DATA=yes in local development",
  );
try {
  const owner = (await db.query("SELECT user_id FROM system_owner")).rows[0];
  if (!owner) throw new Error("First create OWNER using owner:create");
  await transaction(async (tx) => {
    for (const name of ["Проектный отдел", "Маркетинг", "Партнёрства"])
      await tx.query(
        "INSERT INTO departments(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",
        [id(), name],
      );
    for (const [login, name] of [
      ["sample-member", "Тестовый участник"],
      ["sample-captain", "Тестовый капитан"],
    ])
      await tx.query(
        "INSERT INTO users(id,login,display_name,status) VALUES($1,$2,$3,'INVITED') ON CONFLICT(login) DO NOTHING",
        [id(), login, name],
      );
  });
  console.log(
    "Fictional departments and invited users created. No passwords, sessions or fake attendance.",
  );
} finally {
  await closeDb();
}
