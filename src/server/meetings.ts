import { z } from "zod";
import { db, transaction, type DB } from "./db";
import {
  allowed,
  requirePermission,
  fail,
  id,
  uuid,
  audit,
  makeQR,
  verifyQR,
  validateGeo,
  type User,
  rateLimit,
} from "./core";
import {
  arrivalAllowed,
  arrivalOpensAt,
  departureAllowed,
  LATE_AFTER_MINUTES,
} from "../lib/attendance-policy";
const date = z.string().datetime({ offset: true });
export const meetingInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(10000).default(""),
    status: z.enum(["DRAFT", "SCHEDULED", "OPEN"]).default("DRAFT"),
    starts_at: date,
    ends_at: date,
    registration_open_at: date.optional(),
    registration_close_at: date.nullable().optional(),
    checkout_close_at: date.nullable().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    location_label: z.string().max(200).default(""),
    department_id: uuid.nullable().default(null),
    late_after_minutes: z.number().int().min(0).nullable().default(null),
    attendees: z
      .array(
        z
          .object({ user_id: uuid, required: z.boolean().default(true) })
          .strict(),
      )
      .max(2000)
      .default([]),
  })
  .strict()
  .refine(
    (m) => new Date(m.ends_at) > new Date(m.starts_at),
    "Invalid time windows",
  );
export async function meeting(tx: DB, u: User, mid: string, lock = false) {
  uuid.parse(mid);
  const r = await tx.query(
    "SELECT * FROM meetings WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
    [mid],
  );
  const m = r.rows[0];
  if (!m) fail("NOT_FOUND", 404);
  const expected = (
    await tx.query(
      "SELECT 1 FROM meeting_attendees WHERE meeting_id=$1 AND user_id=$2",
      [mid, u.id],
    )
  ).rows.length;
  if (
    !u.owner &&
    !expected &&
    !(await allowed(tx, u, "meetings.manage", {
      meetingId: mid,
      departmentId: m.department_id,
    })) &&
    !(await allowed(tx, u, "meetings.qr.show", {
      meetingId: mid,
      departmentId: m.department_id,
    })) &&
    !(await allowed(tx, u, "attendance.read", {
      meetingId: mid,
      departmentId: m.department_id,
    })) &&
    !(await allowed(tx, u, "feedback.read", {
      meetingId: mid,
      departmentId: m.department_id,
    }))
  )
    fail("NOT_FOUND", 404);
  return m;
}
export async function listMeetings(u: User) {
  const rows = (
    await db.query("SELECT * FROM meetings ORDER BY starts_at DESC LIMIT 500")
  ).rows;
  const out = [];
  for (const m of rows) {
    try {
      await meeting(db, u, m.id);
      out.push(await meetingView(u, m));
    } catch (e) {
      if ((e as { code?: string }).code !== "NOT_FOUND") throw e;
    }
  }
  return out;
}
export async function meetingView(u: User, m: Record<string, any>) {
  const scope = { meetingId: m.id, departmentId: m.department_id };
  return {
    ...m,
    attendance:
      (
        await db.query(
          "SELECT * FROM attendance WHERE meeting_id=$1 AND user_id=$2",
          [m.id, u.id],
        )
      ).rows[0] ?? null,
    expected: !!(
      await db.query(
        "SELECT 1 FROM meeting_attendees WHERE meeting_id=$1 AND user_id=$2",
        [m.id, u.id],
      )
    ).rows.length,
    canQR: await allowed(db, u, "meetings.qr.show", scope),
    canManage: await allowed(db, u, "meetings.manage", scope),
  };
}
export async function createMeeting(u: User, input: unknown) {
  const m = meetingInput.parse(input);
  return transaction(async (tx) => {
    await requirePermission(tx, u, "meetings.create", {
      departmentId: m.department_id,
    });
    if (
      m.department_id &&
      !(
        await tx.query(
          "SELECT 1 FROM departments WHERE id=$1 AND status='ACTIVE'",
          [m.department_id],
        )
      ).rows.length
    )
      fail("INVALID_INPUT");
    const mid = id();
    await tx.query(
      `INSERT INTO meetings(id,title,description,status,starts_at,ends_at,registration_open_at,registration_close_at,checkout_close_at,latitude,longitude,location_label,department_id,late_after_minutes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        mid,
        m.title,
        m.description,
        m.status,
        m.starts_at,
        m.ends_at,
        new Date(arrivalOpensAt(m.starts_at)).toISOString(),
        null,
        null,
        m.latitude,
        m.longitude,
        m.location_label,
        m.department_id,
        LATE_AFTER_MINUTES,
        u.id,
      ],
    );
    for (const a of m.attendees) {
      if (
        m.department_id &&
        !u.owner &&
        !(
          await tx.query(
            "SELECT 1 FROM department_memberships WHERE user_id=$1 AND department_id=$2 AND valid_to IS NULL",
            [a.user_id, m.department_id],
          )
        ).rows.length
      )
        fail("FORBIDDEN", 403);
      await tx.query(
        `INSERT INTO meeting_attendees(meeting_id,user_id,required,department_id) SELECT $1,id,$3,$4 FROM users WHERE id=$2 AND status='ACTIVE'`,
        [
          mid,
          a.user_id,
          a.required,
          m.department_id ??
            (
              await tx.query(
                "SELECT department_id FROM department_memberships WHERE user_id=$1 AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1",
                [a.user_id],
              )
            ).rows[0]?.department_id ??
            null,
        ],
      );
    }
    await audit(tx, u, "meeting.create", "meeting", mid, null, {
      title: m.title,
      status: m.status,
    });
    return { id: mid };
  });
}
export async function updateMeeting(u: User, mid: string, input: unknown) {
  const p = z
    .object({
      status: z
        .enum(["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "CANCELLED"])
        .optional(),
      title: z.string().min(1).max(160).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const m = await meeting(tx, u, mid, true);
    await requirePermission(tx, u, "meetings.manage", {
      meetingId: mid,
      departmentId: m.department_id,
    });
    if (["CLOSED", "CANCELLED"].includes(m.status)) fail("MEETING_CLOSED");
    if (p.latitude !== undefined || p.longitude !== undefined) {
      if (
        (
          await tx.query(
            "SELECT 1 FROM attendance WHERE meeting_id=$1 LIMIT 1",
            [mid],
          )
        ).rows.length
      )
        fail("LOCATION_LOCKED");
    }
    const transitions: Record<string, string[]> = {
      DRAFT: ["SCHEDULED", "CANCELLED"],
      SCHEDULED: ["OPEN", "CANCELLED"],
      OPEN: ["CLOSED", "CANCELLED"],
    };
    if (p.status && !transitions[m.status]?.includes(p.status))
      fail("INVALID_TRANSITION");
    await tx.query(
      "UPDATE meetings SET title=$2,status=$3,latitude=$4,longitude=$5,qr_version=qr_version+1 WHERE id=$1",
      [
        mid,
        p.title ?? m.title,
        p.status ?? m.status,
        p.latitude ?? m.latitude,
        p.longitude ?? m.longitude,
      ],
    );
    await audit(
      tx,
      u,
      "meeting.update",
      "meeting",
      mid,
      { title: m.title, status: m.status },
      p,
    );
    return { ok: true };
  });
}
export async function qr(u: User, mid: string) {
  const m = await meeting(db, u, mid);
  await requirePermission(db, u, "meetings.qr.show", {
    meetingId: mid,
    departmentId: m.department_id,
  });
  if (!arrivalAllowed(m as { status: string; starts_at: string }))
    fail("MEETING_CLOSED");
  await audit(db, u, "meeting.qr.show", "meeting", mid);
  return { ...makeQR(mid, m.qr_version), title: m.title };
}
export async function challenge(u: User, mid: string, action: string) {
  if (!["check-in", "check-out"].includes(action)) fail("INVALID_INPUT");
  const m = await meeting(db, u, mid);
  if (
    action === "check-in"
      ? !arrivalAllowed(m as { status: string; starts_at: string })
      : !departureAllowed(m.status)
  )
    fail("MEETING_CLOSED");
  if (
    !(
      await db.query(
        "SELECT 1 FROM meeting_attendees WHERE meeting_id=$1 AND user_id=$2",
        [mid, u.id],
      )
    ).rows.length
  )
    fail("FORBIDDEN", 403);
  await rateLimit(db, "geo:" + u.id, 30, 300);
  const cid = id();
  await db.query(
    "INSERT INTO geo_challenges(id,user_id,meeting_id,action,expires_at) VALUES($1,$2,$3,$4,now()+interval '60 seconds')",
    [cid, u.id, mid, action],
  );
  return { challenge: cid };
}
export async function mark(
  u: User,
  mid: string,
  action: "check-in" | "check-out",
  input: unknown,
) {
  const p = z
    .object({
      challenge: uuid,
      token: z.string().max(2000).optional(),
      geo: z.unknown(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const m = await meeting(tx, u, mid, true);
    if (
      !(
        await tx.query(
          "SELECT 1 FROM meeting_attendees WHERE meeting_id=$1 AND user_id=$2",
          [mid, u.id],
        )
      ).rows.length
    )
      fail("FORBIDDEN", 403);
    // Meeting row lock serializes close, cancel and attendance. Retry returns authoritative existing record only.
    const existing = (
      await tx.query(
        "SELECT * FROM attendance WHERE meeting_id=$1 AND user_id=$2",
        [mid, u.id],
      )
    ).rows[0];
    if (action === "check-in" && existing)
      return { attendance: existing, repeated: true };
    if (action === "check-out" && existing?.check_out_at)
      return { attendance: existing, repeated: true };
    const now = Date.now();
    if (
      action === "check-in"
        ? !arrivalAllowed(m as { status: string; starts_at: string }, now)
        : !departureAllowed(m.status)
    )
      fail("MEETING_CLOSED");
    if (action === "check-out" && !existing) fail("CHECK_IN_REQUIRED");
    if (action === "check-in") verifyQR(p.token ?? "", mid, m.qr_version, now);
    const c = (
      await tx.query(
        "SELECT * FROM geo_challenges WHERE id=$1 AND user_id=$2 AND meeting_id=$3 AND action=$4 FOR UPDATE",
        [p.challenge, u.id, mid, action],
      )
    ).rows[0];
    if (!c || c.used_at || new Date(c.expires_at).getTime() <= now)
      fail("GEO_STALE");
    const geo = validateGeo(
      p.geo,
      m as { latitude: number; longitude: number },
      now,
    );
    if (action === "check-in")
      await tx.query(
        "INSERT INTO attendance(id,meeting_id,user_id,check_in_at,check_in_distance_m,check_in_accuracy) VALUES($1,$2,$3,now(),$4,$5)",
        [id(), mid, u.id, geo.distance, geo.accuracy],
      );
    else
      await tx.query(
        "UPDATE attendance SET check_out_at=now(),check_out_distance_m=$3,check_out_accuracy=$4 WHERE meeting_id=$1 AND user_id=$2 AND check_out_at IS NULL",
        [mid, u.id, geo.distance, geo.accuracy],
      );
    await tx.query("UPDATE geo_challenges SET used_at=now() WHERE id=$1", [
      p.challenge,
    ]);
    return {
      attendance: (
        await tx.query(
          "SELECT * FROM attendance WHERE meeting_id=$1 AND user_id=$2",
          [mid, u.id],
        )
      ).rows[0],
      repeated: false,
    };
  });
}
