import "dotenv/config";
import { transaction, closeDb } from "../src/server/db";
import { digest, secret, id } from "../src/server/core";
// Only an operator who already controls the database/server can run this.
if (!process.env.APP_ORIGIN || process.argv[2] !== "--confirm")
  throw new Error(
    "Usage: npm run owner:recover -- --confirm (APP_ORIGIN required)",
  );
try {
  const path = await transaction(async (tx) => {
    const r = (
      await tx.query(
        "SELECT u.id FROM system_owner o JOIN users u ON u.id=o.user_id FOR UPDATE OF u",
      )
    ).rows[0];
    if (!r) throw new Error("Owner has not been created");
    await tx.query(
      "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [r.id],
    );
    await tx.query(
      "UPDATE activation_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [r.id],
    );
    const token = secret();
    await tx.query(
      "INSERT INTO activation_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [digest(token), r.id],
    );
    await tx.query(
      "INSERT INTO audit_log(id,actor_id,action,object_type,object_id) VALUES($1,$2,'owner.recovery','user',$2)",
      [id(), r.id],
    );
    return "/activate#" + token;
  });
  console.log(
    "Private one-time owner recovery link (1 hour):\n" +
      process.env.APP_ORIGIN +
      path,
  );
} finally {
  await closeDb();
}
