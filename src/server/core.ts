import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(code);
  }
}
export const fail = (code: string, status = 400, details?: unknown): never => {
  throw new AppError(code, status, details);
};
export const id = () => randomUUID();
export const secret = () => randomBytes(32).toString("base64url");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const uuid = z.string().uuid();
export const permissions = [
  "users.manage",
  "departments.manage",
  "meetings.create",
  "meetings.manage",
  "meetings.qr.show",
  "attendance.read",
  "tasks.create",
  "tasks.manage",
  "tasks.review",
  "feedback.read",
  "feedback.manage",
  "reports.export",
] as const;
export type User = {
  id: string;
  login: string;
  display_name: string;
  owner: boolean;
};
export type Scope = { meetingId?: string; departmentId?: string | null };
export async function allowed(tx: DB, u: User, p: string, s: Scope = {}) {
  if (u.owner) return true;
  const r = await tx.query(
    `SELECT 1 FROM permission_grants WHERE grantee_id=$1 AND permission=$2 AND revoked_at IS NULL AND (scope_type='TEAM' OR (scope_type='DEPARTMENT' AND scope_id=$3) OR (scope_type='MEETING' AND scope_id=$4)) LIMIT 1`,
    [u.id, p, s.departmentId ?? null, s.meetingId ?? null],
  );
  return !!r.rows.length;
}
export async function requirePermission(
  tx: DB,
  u: User,
  p: string,
  s: Scope = {},
) {
  if (!(await allowed(tx, u, p, s))) fail("FORBIDDEN", 403);
}
export function requireOwner(u: User) {
  if (!u.owner) fail("FORBIDDEN", 403);
}
export async function audit(
  tx: DB,
  u: User,
  action: string,
  type: string,
  objectId: string | null,
  before: unknown = null,
  after: unknown = null,
) {
  await tx.query(
    "INSERT INTO audit_log(id,actor_id,action,object_type,object_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id(),
      u.id,
      action,
      type,
      objectId,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}
export async function rateLimit(
  tx: DB,
  key: string,
  max: number,
  seconds: number,
) {
  const r = await tx.query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<=now() THEN now()+$2*interval '1 second' ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  if (r.rows[0].count > max) fail("RATE_LIMITED", 429);
}
function qrSecret() {
  const s = process.env.QR_SECRET;
  if (!s || s.length < 32)
    throw new Error("QR_SECRET requires >=32 characters");
  return s;
}
export function makeQR(meetingId: string, version: number, now = Date.now()) {
  const interval = Math.floor(now / 180000);
  const expiresAt = (interval + 1) * 180000;
  const data = Buffer.from(
    JSON.stringify({
      meetingId,
      version,
      purpose: "check-in",
      interval,
      expiresAt,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", qrSecret())
    .update(data)
    .digest("base64url");
  return { token: `${data}.${signature}`, expiresAt, serverTime: now };
}
export function verifyQR(
  token: string,
  meetingId: string,
  version: number,
  now = Date.now(),
) {
  const parts = token.split(".");
  if (parts.length !== 2) fail("QR_INVALID");
  const [data, signature] = parts;
  const expected = createHmac("sha256", qrSecret()).update(data).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    fail("QR_INVALID");
  }
  if (actual!.length !== expected.length || !timingSafeEqual(actual!, expected))
    fail("QR_INVALID");
  let p;
  try {
    p = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    fail("QR_INVALID");
  }
  if (
    !p ||
    typeof p !== "object" ||
    !Number.isSafeInteger(p.interval) ||
    p.meetingId !== meetingId ||
    p.version !== version ||
    p.purpose !== "check-in" ||
    p.expiresAt !== (p.interval + 1) * 180000
  )
    fail("QR_INVALID");
  if (now >= p.expiresAt) fail("QR_EXPIRED");
  if (p.interval !== Math.floor(now / 180000)) fail("QR_INVALID");
}
export function distance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
export const geoSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0),
    timestamp: z.number().finite(),
  })
  .strict();
export function validateGeo(
  input: unknown,
  meeting: { latitude: number; longitude: number },
  now = Date.now(),
) {
  const parsed = geoSchema.safeParse(input);
  if (!parsed.success) fail("GEO_UNAVAILABLE");
  const g = parsed.data!;
  if (
    g.timestamp > now + 5000 ||
    now - g.timestamp >
      z.coerce
        .number()
        .finite()
        .positive()
        .max(300)
        .parse(process.env.GEO_MAX_AGE_SECONDS ?? 30) *
        1000
  )
    fail("GEO_STALE");
  if (
    g.accuracy >
    z.coerce
      .number()
      .finite()
      .positive()
      .max(1000)
      .parse(process.env.GEO_MAX_ACCURACY ?? 100)
  )
    fail("GEO_INACCURATE");
  const d = distance(
    meeting.latitude,
    meeting.longitude,
    g.latitude,
    g.longitude,
  );
  if (d > 200 + 1e-7)
    fail("GEO_OUTSIDE_RADIUS", 400, { distance: Math.round(d), radius: 200 });
  return { distance: d, accuracy: g.accuracy };
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "\uFEFF";
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const keys = Object.keys(rows[0]);
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(","),
      ...rows.map((r) => keys.map((k) => cell(r[k])).join(",")),
    ].join("\r\n")
  );
}
