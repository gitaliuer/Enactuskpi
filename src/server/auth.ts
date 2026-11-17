import { hash, verify } from "@node-rs/argon2";
import { db, transaction } from "./db";
import { digest, secret, id, fail, rateLimit, type User } from "./core";
export const passwordHash = (password: string) =>
  hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function authenticate(req: Request): Promise<User> {
  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("enactus_session="))
    ?.slice(16);
  if (!token) fail("UNAUTHENTICATED", 401);
  const r = await db.query(
    `SELECT u.id,u.login,u.display_name,(o.user_id IS NOT NULL) AS owner FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN system_owner o ON o.user_id=u.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'`,
    [digest(token!)],
  );
  if (!r.rows.length) fail("UNAUTHENTICATED", 401);
  return r.rows[0] as User;
}
export async function login(login: string, password: string) {
  await rateLimit(db, "login:" + digest(login.toLowerCase()), 8, 900);
  const r = await db.query(`SELECT * FROM users WHERE login=$1`, [
    login.toLowerCase(),
  ]);
  const u = r.rows[0]; // A fixed valid dummy hash still invokes Argon2 for unknown accounts.
  const stored = u?.password_hash ?? (await dummyHash);
  const ok = await verify(stored, password).catch(() => false);
  if (!ok || u?.status !== "ACTIVE") fail("INVALID_CREDENTIALS", 401);
  const token = secret();
  await db.query(
    "INSERT INTO sessions(id,user_id,token_hash,expires_at) SELECT $1,id,$2,now()+interval '7 days' FROM users WHERE id=$3 AND status='ACTIVE'",
    [id(), digest(token), u.id],
  );
  return token;
}
const dummyHash = passwordHash("not-a-real-account-password-" + secret());
export async function activate(token: string, password: string) {
  const hashed = await passwordHash(password);
  await transaction(async (tx) => {
    const r = await tx.query(
      `SELECT a.*,u.status FROM activation_tokens a JOIN users u ON u.id=a.user_id WHERE token_hash=$1 FOR UPDATE OF a,u`,
      [digest(token)],
    );
    const a = r.rows[0];
    if (
      !a ||
      a.used_at ||
      new Date(a.expires_at).getTime() <= Date.now() ||
      a.status === "BLOCKED"
    )
      fail("ACTIVATION_INVALID");
    await tx.query(
      "UPDATE users SET password_hash=$1,status='ACTIVE' WHERE id=$2",
      [hashed, a.user_id],
    );
    await tx.query(
      "UPDATE activation_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [a.user_id],
    );
    await tx.query(
      "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [a.user_id],
    );
  });
}
export function sessionCookie(token: string, origin: string) {
  return `enactus_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 604800 : 0}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
