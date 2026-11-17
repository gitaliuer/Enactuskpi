import { z } from "zod";
import { db, transaction } from "./db";
import {
  id,
  uuid,
  fail,
  digest,
  allowed,
  requirePermission,
  rateLimit,
  audit,
  type User,
} from "./core";
export async function sendFeedback(u: User, mid: string, input: unknown) {
  const p = z
    .object({
      mode: z.enum(["ANONYMOUS", "NAMED"]),
      rating: z.number().int().min(1).max(5).nullable().default(null),
      comment: z.string().trim().min(1).max(10000),
      positive: z.string().max(5000).default(""),
      improvement: z.string().max(5000).default(""),
      idempotency_key: uuid,
    })
    .strict()
    .parse(input);
  await rateLimit(db, "feedback:" + u.id, 5, 3600);
  return transaction(async (tx) => {
    const m = (
      await tx.query("SELECT * FROM meetings WHERE id=$1 AND status='CLOSED'", [
        mid,
      ])
    ).rows[0];
    if (
      !m ||
      !(
        await tx.query(
          "SELECT 1 FROM meeting_attendees WHERE meeting_id=$1 AND user_id=$2",
          [mid, u.id],
        )
      ).rows.length
    )
      fail("NOT_FOUND", 404);
    await tx.query("DELETE FROM feedback_dedup WHERE expires_at<=now()");
    const inserted = await tx.query(
      "INSERT INTO feedback_dedup(key_hash,expires_at) VALUES($1,now()+interval '1 hour') ON CONFLICT DO NOTHING RETURNING key_hash",
      [digest(p.idempotency_key)],
    );
    if (!inserted.rows.length) return { ok: true, repeated: true };
    // No audit event or timestamps/identity-linked dedup record for anonymous submission.
    await tx.query(
      "INSERT INTO feedback(id,meeting_id,mode,author_user_id,rating,comment,positive,improvement,coarse_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,($9::timestamptz AT TIME ZONE 'Asia/Almaty')::date)",
      [
        id(),
        mid,
        p.mode,
        p.mode === "NAMED" ? u.id : null,
        p.rating,
        p.comment,
        p.positive,
        p.improvement,
        m.starts_at,
      ],
    );
    return { ok: true };
  });
}
export async function listFeedback(u: User) {
  const rows = (
    await db.query(
      `SELECT f.*,m.title AS meeting_title,m.department_id,u.display_name AS author_name FROM feedback f JOIN meetings m ON m.id=f.meeting_id LEFT JOIN users u ON u.id=f.author_user_id ORDER BY f.coarse_date DESC LIMIT 500`,
    )
  ).rows;
  const result: Record<string, any>[] = [];
  for (const f of rows)
    if (
      await allowed(db, u, "feedback.read", {
        meetingId: f.meeting_id,
        departmentId: f.department_id,
      })
    ) {
      const notes = (
        await db.query(
          "SELECT id,note,operator_id,created_at FROM feedback_notes WHERE feedback_id=$1 ORDER BY created_at",
          [f.id],
        )
      ).rows;
      result.push({
        ...f,
        canManage: await allowed(db, u, "feedback.manage", {
          meetingId: f.meeting_id,
          departmentId: f.department_id,
        }),
        notes,
      });
    }
  return result;
}
export async function processFeedback(u: User, fid: string, input: unknown) {
  const p = z
    .object({
      status: z.enum(["NEW", "VIEWED", "PROCESSED"]),
      note: z.string().max(5000).optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const f = (
      await tx.query(
        "SELECT f.*,m.department_id FROM feedback f JOIN meetings m ON m.id=f.meeting_id WHERE f.id=$1 FOR UPDATE OF f",
        [fid],
      )
    ).rows[0];
    if (
      !f ||
      !(await allowed(tx, u, "feedback.manage", {
        meetingId: f.meeting_id,
        departmentId: f.department_id,
      }))
    )
      fail("NOT_FOUND", 404);
    await requirePermission(tx, u, "feedback.manage", {
      meetingId: f.meeting_id,
      departmentId: f.department_id,
    });
    await tx.query("UPDATE feedback SET status=$2 WHERE id=$1", [
      fid,
      p.status,
    ]);
    if (p.note?.trim())
      await tx.query(
        "INSERT INTO feedback_notes(id,feedback_id,operator_id,note) VALUES($1,$2,$3,$4)",
        [id(), fid, u.id, p.note],
      );
    await audit(tx, u, "feedback.process", "feedback", fid, null, {
      status: p.status,
    });
    return { ok: true };
  });
}
