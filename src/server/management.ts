import { z } from "zod";
import { db, transaction } from "./db";
import {
  id,
  uuid,
  secret,
  digest,
  fail,
  allowed,
  requirePermission,
  requireOwner,
  audit,
  permissions,
  type User,
} from "./core";
export async function users(u: User) {
  const rows = (
    await db.query(
      "SELECT id,login,display_name,status FROM users ORDER BY display_name",
    )
  ).rows;
  const out = [];
  for (const r of rows) {
    if (u.owner || (await allowed(db, u, "users.manage"))) {
      out.push(r);
      continue;
    }
    const memberships = (
      await db.query(
        "SELECT department_id FROM department_memberships WHERE user_id=$1 AND valid_to IS NULL",
        [r.id],
      )
    ).rows;
    for (const m of memberships)
      if (
        (await allowed(db, u, "users.manage", {
          departmentId: m.department_id,
        })) ||
        (await allowed(db, u, "tasks.create", {
          departmentId: m.department_id,
        })) ||
        (await allowed(db, u, "meetings.create", {
          departmentId: m.department_id,
        }))
      ) {
        out.push(r);
        break;
      }
  }
  return out;
}
export async function invite(u: User, input: unknown) {
  const p = z
    .object({
      login: z.string().regex(/^[a-z0-9_.-]{3,50}$/),
      display_name: z.string().trim().min(1).max(100),
      department_id: uuid.nullable().default(null),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    await requirePermission(tx, u, "users.manage", {
      departmentId: p.department_id,
    });
    const uid = id(),
      token = secret();
    await tx.query(
      "INSERT INTO users(id,login,display_name) VALUES($1,$2,$3)",
      [uid, p.login, p.display_name],
    );
    if (p.department_id)
      await tx.query(
        "INSERT INTO department_memberships(id,user_id,department_id) VALUES($1,$2,$3)",
        [id(), uid, p.department_id],
      );
    await tx.query(
      "INSERT INTO activation_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",
      [digest(token), uid],
    );
    await audit(tx, u, "user.invite", "user", uid, null, { login: p.login });
    return { id: uid, activation_path: "/activate#" + token };
  });
}
export async function updateUser(u: User, uid: string, input: unknown) {
  const p = z
    .object({
      status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
      reinvite: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    const target = (
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [uid])
    ).rows[0];
    if (!target) fail("NOT_FOUND", 404);
    if (
      (await tx.query("SELECT 1 FROM system_owner WHERE user_id=$1", [uid]))
        .rows.length
    )
      fail("FORBIDDEN", 403);
    let ok = await allowed(tx, u, "users.manage");
    if (!ok) {
      const memberships = (
        await tx.query(
          "SELECT department_id FROM department_memberships WHERE user_id=$1 AND valid_to IS NULL",
          [uid],
        )
      ).rows;
      for (const m of memberships)
        if (
          await allowed(tx, u, "users.manage", {
            departmentId: m.department_id,
          })
        )
          ok = true;
    }
    if (!ok) fail("NOT_FOUND", 404);
    if (p.status)
      await tx.query("UPDATE users SET status=$2 WHERE id=$1", [uid, p.status]);
    await tx.query(
      "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [uid],
    );
    let path: string | undefined;
    if (p.reinvite) {
      await tx.query(
        "UPDATE activation_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [uid],
      );
      const token = secret();
      await tx.query(
        "INSERT INTO activation_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",
        [digest(token), uid],
      );
      path = "/activate#" + token;
    }
    await audit(tx, u, "user.update", "user", uid, null, p);
    return { ok: true, activation_path: path };
  });
}
export async function departments(u: User) {
  const rows = (await db.query("SELECT * FROM departments ORDER BY name")).rows;
  const out = [];
  for (const d of rows) {
    if (
      u.owner ||
      (await allowed(db, u, "departments.manage", { departmentId: d.id })) ||
      (
        await db.query(
          "SELECT 1 FROM department_memberships WHERE user_id=$1 AND department_id=$2 AND valid_to IS NULL",
          [u.id, d.id],
        )
      ).rows.length ||
      (await allowed(db, u, "meetings.create", { departmentId: d.id })) ||
      (await allowed(db, u, "tasks.create", { departmentId: d.id }))
    ) {
      out.push({
        ...d,
        members: (
          await db.query(
            "SELECT dm.user_id,u.display_name FROM department_memberships dm JOIN users u ON u.id=dm.user_id WHERE department_id=$1 AND valid_to IS NULL",
            [d.id],
          )
        ).rows,
      });
    }
  }
  return out;
}
export async function createDepartment(u: User, input: unknown) {
  const p = z
    .object({ name: z.string().trim().min(1).max(100) })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    await requirePermission(tx, u, "departments.manage");
    const did = id();
    await tx.query("INSERT INTO departments(id,name) VALUES($1,$2)", [
      did,
      p.name,
    ]);
    await audit(tx, u, "department.create", "department", did, null, p);
    return { id: did };
  });
}
export async function updateDepartment(u: User, did: string, input: unknown) {
  const p = z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
      user_id: uuid.optional(),
      remove: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    await requirePermission(tx, u, "departments.manage", { departmentId: did });
    if (p.name)
      await tx.query("UPDATE departments SET name=$2 WHERE id=$1", [
        did,
        p.name,
      ]);
    if (p.status)
      await tx.query("UPDATE departments SET status=$2 WHERE id=$1", [
        did,
        p.status,
      ]);
    if (p.user_id) {
      if (p.remove)
        await tx.query(
          "UPDATE department_memberships SET valid_to=now() WHERE department_id=$1 AND user_id=$2 AND valid_to IS NULL",
          [did, p.user_id],
        );
      else
        await tx.query(
          "INSERT INTO department_memberships(id,user_id,department_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [id(), p.user_id, did],
        );
    }
    await audit(tx, u, "department.update", "department", did, null, p);
    return { ok: true };
  });
}
export async function grant(u: User, input: unknown) {
  requireOwner(u);
  const p = z
    .object({
      grantee_id: uuid,
      permission: z.enum(permissions),
      scope_type: z.enum(["TEAM", "DEPARTMENT", "MEETING"]),
      scope_id: uuid.nullable().default(null),
    })
    .strict()
    .parse(input);
  if ((p.scope_type === "TEAM") !== (p.scope_id === null))
    fail("INVALID_INPUT");
  return transaction(async (tx) => {
    if (p.scope_type !== "TEAM") {
      const table = p.scope_type === "MEETING" ? "meetings" : "departments";
      if (
        !(await tx.query(`SELECT 1 FROM ${table} WHERE id=$1`, [p.scope_id]))
          .rows.length
      )
        fail("INVALID_INPUT");
    }
    const gid = id();
    await tx.query(
      "INSERT INTO permission_grants(id,grantee_id,permission,scope_type,scope_id,granted_by) VALUES($1,$2,$3,$4,$5,$6)",
      [gid, p.grantee_id, p.permission, p.scope_type, p.scope_id, u.id],
    );
    await audit(tx, u, "permission.grant", "permission", gid, null, p);
    return { id: gid };
  });
}
export async function revoke(u: User, gid: string) {
  requireOwner(u);
  return transaction(async (tx) => {
    await tx.query(
      "UPDATE permission_grants SET revoked_at=now() WHERE id=$1",
      [gid],
    );
    await audit(tx, u, "permission.revoke", "permission", gid);
    return { ok: true };
  });
}
