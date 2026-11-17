import "dotenv/config";
import { transaction, closeDb } from "../src/server/db";
try {
  await transaction(async (tx) => {
    await tx.query("DELETE FROM feedback_dedup WHERE expires_at<now()");
    await tx.query("DELETE FROM rate_limits WHERE expires_at<now()");
    await tx.query(
      "DELETE FROM geo_challenges WHERE expires_at<now()-interval '1 hour'",
    );
    await tx.query("DELETE FROM activation_tokens WHERE expires_at<now()");
    await tx.query("DELETE FROM sessions WHERE expires_at<now()");
  });
  console.log(
    "Expired security state removed. Historical business records unchanged.",
  );
} finally {
  await closeDb();
}
