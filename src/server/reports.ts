import { db } from "./db";
import { isLate } from "../lib/attendance-policy";
import { allowed, fail, type User } from "./core";
export async function report(
  u: User,
  params: URLSearchParams,
  exporting = false,
) {
  const rows = (
    await db.query(
      `SELECT m.id AS meeting_id,m.title,m.starts_at,m.status AS meeting_status,m.late_after_minutes,ma.user_id,ma.department_id,ma.required,u.display_name,a.check_in_at,a.check_out_at,CASE WHEN a.check_out_at IS NOT NULL THEN a.check_out_source END AS check_out_source,a.check_out_recorded_by,a.check_out_recorded_at,a.check_out_reason FROM meeting_attendees ma JOIN meetings m ON m.id=ma.meeting_id JOIN users u ON u.id=ma.user_id LEFT JOIN attendance a ON a.meeting_id=ma.meeting_id AND a.user_id=ma.user_id WHERE m.status<>'CANCELLED' ORDER BY m.starts_at DESC`,
    )
  ).rows;
  const out: Record<string, any>[] = [];
  for (const r of rows) {
    const scope = { meetingId: r.meeting_id, departmentId: r.department_id };
    if (exporting && !(await allowed(db, u, "reports.export", scope))) continue;
    if (r.user_id !== u.id && !(await allowed(db, u, "attendance.read", scope)))
      continue;
    if (params.get("user") && r.user_id !== params.get("user")) continue;
    if (
      params.get("department") &&
      r.department_id !== params.get("department")
    )
      continue;
    if (params.get("meeting") && r.meeting_id !== params.get("meeting"))
      continue;
    if (
      params.get("from") &&
      new Date(r.starts_at) < new Date(params.get("from")!)
    )
      continue;
    if (params.get("to") && new Date(r.starts_at) > new Date(params.get("to")!))
      continue;
    const closed = r.meeting_status === "CLOSED";
    out.push({
      ...r,
      result: r.check_in_at
        ? r.check_out_at
          ? "CHECKED_OUT"
          : closed
            ? "MISSING_CHECK_OUT"
            : "CHECKED_IN"
        : closed && r.required
          ? "ABSENT"
          : "NOT_MARKED",
      late: r.check_in_at ? isLate(r.check_in_at, r.starts_at) : null,
      minutes_between_marks: r.check_out_at
        ? Math.round(
            (new Date(r.check_out_at).getTime() -
              new Date(r.check_in_at).getTime()) /
              60000,
          )
        : null,
    });
  }
  if (exporting && !u.owner && !out.length) {
    const grants = await db.query(
      "SELECT 1 FROM permission_grants WHERE grantee_id=$1 AND permission='reports.export' AND revoked_at IS NULL",
      [u.id],
    );
    if (!grants.rows.length) fail("FORBIDDEN", 403);
  }
  const visibleTasks: Record<string, any>[] = [];
  for (const t of (
    await db.query(
      "SELECT t.*,u.display_name FROM tasks t JOIN users u ON u.id=t.assigned_to",
    )
  ).rows) {
    const scope = { departmentId: t.department_id };
    if (
      t.assigned_to !== u.id &&
      !(await allowed(db, u, "tasks.manage", scope)) &&
      !(await allowed(db, u, "tasks.review", scope))
    )
      continue;
    if (exporting && !(await allowed(db, u, "reports.export", scope))) continue;
    if (params.get("user") && t.assigned_to !== params.get("user")) continue;
    if (params.get("meeting")) continue; // Tasks are not implicitly associated with a meeting.
    if (
      params.get("department") &&
      t.department_id !== params.get("department")
    )
      continue;
    if (
      params.get("from") &&
      new Date(t.due_at) < new Date(params.get("from")!)
    )
      continue;
    if (params.get("to") && new Date(t.due_at) > new Date(params.get("to")!))
      continue;
    visibleTasks.push(t);
  }
  const metricsFor = (
    att: Record<string, any>[],
    tasks: Record<string, any>[],
  ) => {
    const required = att.filter(
      (r) => r.required && r.meeting_status === "CLOSED",
    );
    return {
      required: required.length,
      visited: required.filter((r) => r.check_in_at).length,
      absent: required.filter((r) => !r.check_in_at).length,
      late: att.filter((r) => r.late).length,
      missingCheckout: att.filter((r) => r.result === "MISSING_CHECK_OUT")
        .length,
      accepted: tasks.filter((t) => t.status === "DONE").length,
      onTime: tasks.filter(
        (t) =>
          t.status === "DONE" &&
          new Date(t.accepted_at) <= new Date(t.accepted_due_at),
      ).length,
      overdue: tasks.filter(
        (t) => t.status !== "DONE" && new Date(t.due_at).getTime() < Date.now(),
      ).length,
    };
  };
  const people = new Map<string, string>();
  for (const r of out) people.set(r.user_id, r.display_name);
  for (const t of visibleTasks) people.set(t.assigned_to, t.display_name);
  return {
    rows: out,
    metrics: metricsFor(
      out.filter((r) => r.user_id === u.id),
      visibleTasks.filter((t) => t.assigned_to === u.id),
    ),
    summary: [...people].map(([user_id, display_name]) => ({
      user_id,
      display_name,
      ...metricsFor(
        out.filter((r) => r.user_id === user_id),
        visibleTasks.filter((t) => t.assigned_to === user_id),
      ),
    })),
  };
}
