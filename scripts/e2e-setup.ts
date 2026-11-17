import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { migrate } from "./migrate";
import { db, closeDb, transaction } from "../src/server/db";
import { id, secret } from "../src/server/core";
import { passwordHash } from "../src/server/auth";
if (
  process.env.LOCAL_DATABASE !== "1" ||
  !process.env.LOCAL_DATABASE_PATH?.includes("e2e") ||
  process.env.VERCEL
)
  throw new Error("E2E database only");
try {
  await migrate();
  const password = secret();
  const memberPassword = secret();
  await transaction(async (tx) => {
    await tx.query(
      "TRUNCATE users,departments,rate_limits,feedback_dedup CASCADE",
    );
    const uid = id(),
      member = id();
    await tx.query(
      "INSERT INTO users(id,login,display_name,password_hash,status) VALUES($1,'e2e-owner','Али',$2,'ACTIVE'),($3,'e2e-member','Тестовый участник',$4,'ACTIVE')",
      [
        uid,
        await passwordHash(password),
        member,
        await passwordHash(memberPassword),
      ],
    );
    await tx.query("INSERT INTO system_owner(user_id) VALUES($1)", [uid]);
  });
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/e2e-credentials.json",
    JSON.stringify({
      login: "e2e-owner",
      password,
      memberLogin: "e2e-member",
      memberPassword,
    }),
    { mode: 0o600 },
  );
  console.log(
    "Isolated E2E fixture ready. Credentials saved in ignored private file.",
  );
} finally {
  await closeDb();
}
