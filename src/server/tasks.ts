import { z } from "zod";
import { db, transaction, type DB } from "./db";
import {
  allowed,
  requirePermission,
  id,
  uuid,
  fail,
  audit,
  type User,
} from "./core";
const safeURL = z
  .string()
  .url()
  .max(2000)
  .refine((s) => ["https:", "http:"].includes(new URL(s).protocol));
export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10000).default(""),
    department_id: uuid.nullable().default(null),
    assigned_to: uuid,
    collaborators: z.array(uuid).max(100).default([]),
    due_at: z.string().datetime({ offset: true }),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
    expected_result: z.string().max(3000).default(""),
  })
  .strict();
async function member(tx: DB, userId: string, departmentId: string) {
  return !!(
    await tx.query(
      "SELECT 1 FROM department_memberships WHERE user_id=$1 AND department_id=$2 AND valid_to IS NULL",
      [userId, departmentId],
    )
  ).rows.length;
}
export async function taskVisible(tx: DB, u: User, t: Record<string, any>) {
  return (
    u.owner ||
    t.assigned_to === u.id ||
    !!(
      await tx.query(
        "SELECT 1 FROM task_collaborators WHERE task_id=$1 AND user_id=$2",
        [t.id, u.id],
      )
    ).rows.length ||
    (!!t.department_id && (await member(tx, u.id, t.department_id))) ||
    (await allowed(tx, u, "tasks.manage", { departmentId: t.department_id })) ||
    (await allowed(tx, u, "tasks.review", { departmentId: t.department_id }))
  );
}
export async function getTask(tx: DB, u: User, tid: string, lock = false) {
  uuid.parse(tid);
  const t = (
    await tx.query(
      "SELECT * FROM tasks WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [tid],
    )
  ).rows[0];
  if (!t || !(await taskVisible(tx, u, t))) fail("NOT_FOUND", 404);
  return t;
}
export async function listTasks(u: User) {
  const tasks = (
    await db.query(
      "SELECT t.*,u.display_name AS assignee_name FROM tasks t JOIN users u ON u.id=t.assigned_to ORDER BY due_at LIMIT 500",
    )
  ).rows;
  const out = [];
  for (const t of tasks)
    if (await taskVisible(db, u, t))
      out.push({
        ...t,
        canReview: await allowed(db, u, "tasks.review", {
          departmentId: t.department_id,
        }),
        canManage: await allowed(db, u, "tasks.manage", {
          departmentId: t.department_id,
        }),
        canWork:
          t.assigned_to === u.id ||
          !!(
            await db.query(
              "SELECT 1 FROM task_collaborators WHERE task_id=$1 AND user_id=$2",
              [t.id, u.id],
            )
          ).rows.length,
      });
  return out;
}
async function event(
  tx: DB,
  u: User,
  tid: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  await tx.query(
    "INSERT INTO task_events(id,task_id,actor_id,event,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)",
    [id(), tid, u.id, action, JSON.stringify(before), JSON.stringify(after)],
  );
}
export async function createTask(u: User, input: unknown) {
  const p = taskInput.parse(input);
  return transaction(async (tx) => {
    await requirePermission(tx, u, "tasks.create", {
      departmentId: p.department_id,
    });
    if (p.department_id) {
      for (const uid of [p.assigned_to, ...p.collaborators])
        if (!(await member(tx, uid, p.department_id))) fail("INVALID_ASSIGNEE");
    }
    const tid = id();
    await tx.query(
      "INSERT INTO tasks(id,title,description,department_id,assigned_to,due_at,original_due_at,priority,created_by,expected_result) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)",
      [
        tid,
        p.title,
        p.description,
        p.department_id,
        p.assigned_to,
        p.due_at,
        p.priority,
        u.id,
        p.expected_result,
      ],
    );
    for (const uid of new Set(p.collaborators))
      await tx.query(
        "INSERT INTO task_collaborators(task_id,user_id) VALUES($1,$2)",
        [tid, uid],
      );
    await event(tx, u, tid, "CREATED", null, p);
    await audit(tx, u, "task.create", "task", tid);
    return { id: tid };
  });
}
export async function updateTask(u: User, tid: string, input: unknown) {
  const p = z
    .object({
      due_at: z.string().datetime({ offset: true }).optional(),
      assigned_to: uuid.optional(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(10000).optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const t = await getTask(tx, u, tid, true);
    await requirePermission(tx, u, "tasks.manage", {
      departmentId: t.department_id,
    });
    if (t.status === "DONE") fail("INVALID_TRANSITION");
    if (
      p.assigned_to &&
      t.department_id &&
      !(await member(tx, p.assigned_to, t.department_id))
    )
      fail("INVALID_ASSIGNEE");
    await tx.query(
      "UPDATE tasks SET due_at=$2,assigned_to=$3,title=$4,description=$5 WHERE id=$1",
      [
        tid,
        p.due_at ?? t.due_at,
        p.assigned_to ?? t.assigned_to,
        p.title ?? t.title,
        p.description ?? t.description,
      ],
    );
    await event(
      tx,
      u,
      tid,
      "UPDATED",
      { due_at: t.due_at, assigned_to: t.assigned_to, title: t.title },
      p,
    );
    await audit(tx, u, "task.update", "task", tid, null, p);
    return { ok: true };
  });
}
export async function transitionTask(
  u: User,
  tid: string,
  action: string,
  input: unknown,
) {
  const p = z
    .object({
      comment: z.string().max(5000).default(""),
      result_url: safeURL.optional(),
      accept: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const t = await getTask(tx, u, tid, true);
    let next = t.status;
    if (action === "review") {
      await requirePermission(tx, u, "tasks.review", {
        departmentId: t.department_id,
      });
      if (t.status !== "IN_REVIEW" || p.accept === undefined)
        fail("INVALID_TRANSITION");
      if (!p.accept && !p.comment.trim()) fail("COMMENT_REQUIRED");
      next = p.accept ? "DONE" : "IN_PROGRESS";
    } else {
      if (
        t.assigned_to !== u.id &&
        !(
          await tx.query(
            "SELECT 1 FROM task_collaborators WHERE task_id=$1 AND user_id=$2",
            [tid, u.id],
          )
        ).rows.length
      )
        fail("FORBIDDEN", 403);
      if (action === "start" && t.status === "TODO") next = "IN_PROGRESS";
      else if (
        action === "submit" &&
        ["TODO", "IN_PROGRESS"].includes(t.status)
      )
        next = "IN_REVIEW";
      else if (action !== "comment") fail("INVALID_TRANSITION");
    }
    if (p.comment || p.result_url)
      await tx.query(
        "INSERT INTO task_comments(id,task_id,user_id,comment,result_url) VALUES($1,$2,$3,$4,$5)",
        [id(), tid, u.id, p.comment, p.result_url ?? null],
      );
    await tx.query(
      "UPDATE tasks SET status=$2,accepted_at=CASE WHEN $2='DONE' THEN now() ELSE accepted_at END,accepted_due_at=CASE WHEN $2='DONE' THEN due_at ELSE accepted_due_at END WHERE id=$1",
      [tid, next],
    );
    await event(
      tx,
      u,
      tid,
      action,
      { status: t.status },
      { status: next, comment: p.comment },
    );
    if (action === "review")
      await audit(tx, u, "task.review", "task", tid, null, { status: next });
    return { ok: true };
  });
}
export async function taskDetail(
  u: User,
  tid: string,
): Promise<Record<string, any>> {
  const t = await getTask(db, u, tid);
  return {
    ...t,
    comments: (
      await db.query(
        "SELECT c.*,u.display_name FROM task_comments c JOIN users u ON u.id=c.user_id WHERE task_id=$1 ORDER BY created_at",
        [tid],
      )
    ).rows,
    events: (
      await db.query(
        "SELECT * FROM task_events WHERE task_id=$1 ORDER BY created_at",
        [tid],
      )
    ).rows,
  };
}
