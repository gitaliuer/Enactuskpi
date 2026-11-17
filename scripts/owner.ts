import "dotenv/config";
import { transaction, closeDb } from "../src/server/db";
import { id, secret, digest } from "../src/server/core";
const login = process.argv[2];
if (!login || !process.env.APP_ORIGIN)
  throw new Error("Usage: npm run owner:create -- ali (APP_ORIGIN required)");
try {
  const link = await transaction(async (tx) => {
    await tx.query("LOCK TABLE system_owner IN EXCLUSIVE MODE");
    if ((await tx.query("SELECT 1 FROM system_owner")).rows.length)
      throw new Error("Owner already exists");
    const uid = id(),
      token = secret();
    await tx.query(
      "INSERT INTO users(id,login,display_name) VALUES($1,$2,$3)",
      [uid, login, "Али"],
    );
    await tx.query("INSERT INTO system_owner(user_id) VALUES($1)", [uid]);
    await tx.query(
      "INSERT INTO activation_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), uid],
    );
    return process.env.APP_ORIGIN + "/activate#" + token;
  });
  console.log("Private one-time owner activation link (1 hour):\n" + link);
} finally {
  await closeDb();
}
