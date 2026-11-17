import { beforeAll, afterAll, describe, it, expect } from "vitest";
process.env.LOCAL_DATABASE = "1";
process.env.LOCAL_DATABASE_PATH = "memory://";
process.env.QR_SECRET = "integration-secret-".repeat(3);
import { db, closeDb, transaction } from "../src/server/db";
import { migrate } from "../scripts/migrate";
import { id, makeQR, allowed, type User } from "../src/server/core";
import {
  passwordHash,
  activate,
  login,
  authenticate,
} from "../src/server/auth";
import * as management from "../src/server/management";
import * as meetings from "../src/server/meetings";
import * as tasks from "../src/server/tasks";
import * as feedback from "../src/server/feedback";
import { report } from "../src/server/reports";
let owner: User, alice: User, bob: User, mid: string, dept: string;
const geo = () => ({
  latitude: 45,
  longitude: 78,
  accuracy: 10,
  timestamp: Date.now(),
});
const meetingPayload = () => {
  const d = (n: number) => new Date(Date.now() + n * 60000).toISOString();
  return {
    title: "Командная встреча",
    status: "OPEN",
    starts_at: d(-10),
    ends_at: d(60),
    registration_open_at: d(-20),
    registration_close_at: d(30),
    checkout_close_at: d(90),
    latitude: 45,
    longitude: 78,
    department_id: dept,
    attendees: [
      { user_id: alice.id, required: true },
      { user_id: bob.id, required: true },
    ],
  };
};
beforeAll(async () => {
  await migrate();
  owner = { id: id(), login: "ali", display_name: "Али", owner: true };
  alice = { id: id(), login: "alice", display_name: "Алия", owner: false };
  bob = { id: id(), login: "bob", display_name: "Боб", owner: false };
  for (const u of [owner, alice, bob])
    await db.query(
      "INSERT INTO users(id,login,display_name,status,password_hash) VALUES($1,$2,$3,'ACTIVE',$4)",
      [
        u.id,
        u.login,
        u.display_name,
        await passwordHash("test-password-12345"),
      ],
    );
  await db.query("INSERT INTO system_owner(user_id) VALUES($1)", [owner.id]);
  dept = (await management.createDepartment(owner, { name: "Проекты" })).id;
  for (const u of [alice, bob])
    await management.updateDepartment(owner, dept, { user_id: u.id });
  mid = (await meetings.createMeeting(owner, meetingPayload())).id;
}, 30000);
afterAll(closeDb);
describe("auth and OWNER invariants", () => {
  it("passwords are Argon2 hashes, login, logout/revoke and blocked sessions", async () => {
    const hash = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [alice.id])
    ).rows[0].password_hash;
    expect(hash).toMatch(/^\$argon2id\$/);
    const token = await login("alice", "test-password-12345");
    const req = new Request("http://localhost", {
      headers: { cookie: "enactus_session=" + token },
    });
    expect((await authenticate(req)).id).toBe(alice.id);
    await management.updateUser(owner, alice.id, { status: "BLOCKED" });
    await expect(authenticate(req)).rejects.toThrow("UNAUTHENTICATED");
    await expect(login("alice", "test-password-12345")).rejects.toThrow(
      "INVALID_CREDENTIALS",
    );
    await management.updateUser(owner, alice.id, { status: "ACTIVE" });
    await expect(authenticate(req)).rejects.toThrow("UNAUTHENTICATED");
  });
  it("no unauthenticated read and no second owner", async () => {
    await expect(authenticate(new Request("http://localhost"))).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await expect(
      db.query("INSERT INTO system_owner(user_id) VALUES($1)", [alice.id]),
    ).rejects.toThrow();
    await expect(
      management.updateUser(owner, owner.id, { status: "BLOCKED" }),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("one-time activation does not expose the password", async () => {
    const r = await management.invite(owner, {
      login: "new-person",
      display_name: "Новый участник",
    });
    const token = r.activation_path.split("#")[1];
    await activate(token, "my-long-password");
    await expect(activate(token, "another-password")).rejects.toThrow(
      "ACTIVATION_INVALID",
    );
    expect(
      (
        await db.query(
          "SELECT token_hash FROM activation_tokens WHERE user_id=$1",
          [r.id],
        )
      ).rows[0].token_hash,
    ).not.toBe(token);
  });
});
describe("scoped permissions and IDOR", () => {
  it("delegate cannot grant permissions or mass assign owner", async () => {
    await expect(
      management.grant(alice, {
        grantee_id: alice.id,
        permission: "users.manage",
        scope_type: "TEAM",
      }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      management.updateUser(owner, bob.id, { owner: true }),
    ).rejects.toThrow();
  });
  it("QR permission does not grant feedback read and revocation is immediate", async () => {
    const g = await management.grant(owner, {
      grantee_id: alice.id,
      permission: "meetings.qr.show",
      scope_type: "MEETING",
      scope_id: mid,
    });
    expect((await meetings.qr(alice, mid)).token).toBeTruthy();
    expect(
      await allowed(db, alice, "feedback.read", {
        meetingId: mid,
        departmentId: dept,
      }),
    ).toBe(false);
    await management.revoke(owner, g.id);
    await expect(meetings.qr(alice, mid)).rejects.toThrow("FORBIDDEN");
  });
  it("foreign meeting is hidden", async () => {
    const p = meetingPayload();
    p.attendees = [];
    const other = (await meetings.createMeeting(owner, p)).id;
    await expect(meetings.meeting(db, alice, other)).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
describe("attendance transactions", () => {
  it("rejects checkout without arrival and outside/poor/stale geo without a record", async () => {
    const c = await meetings.challenge(alice, mid, "check-out");
    await expect(
      meetings.mark(alice, mid, "check-out", {
        challenge: c.challenge,
        geo: geo(),
      }),
    ).rejects.toThrow("CHECK_IN_REQUIRED");
    for (const g of [
      { ...geo(), latitude: 46 },
      { ...geo(), accuracy: 101 },
      { ...geo(), timestamp: Date.now() - 40000 },
    ]) {
      const c = await meetings.challenge(alice, mid, "check-in");
      const token = (await meetings.qr(owner, mid)).token;
      await expect(
        meetings.mark(alice, mid, "check-in", {
          challenge: c.challenge,
          token,
          geo: g,
        }),
      ).rejects.toThrow();
    }
    expect(
      (await db.query("SELECT 1 FROM attendance WHERE meeting_id=$1", [mid]))
        .rows,
    ).toHaveLength(0);
  });
  it("same QR works for two users; parallel retries create one record", async () => {
    const token = (await meetings.qr(owner, mid)).token;
    const c = await meetings.challenge(alice, mid, "check-in");
    const input = { challenge: c.challenge, token, geo: geo() };
    const results = await Promise.all([
      meetings.mark(alice, mid, "check-in", input),
      meetings.mark(alice, mid, "check-in", input),
    ]);
    expect(results[0].attendance.id).toBe(results[1].attendance.id);
    const b = await meetings.challenge(bob, mid, "check-in");
    await meetings.mark(bob, mid, "check-in", {
      challenge: b.challenge,
      token,
      geo: geo(),
    });
    expect(
      (await db.query("SELECT 1 FROM attendance WHERE meeting_id=$1", [mid]))
        .rows,
    ).toHaveLength(2);
  });
  it("locks location after first attendance; double checkout cannot overwrite", async () => {
    await expect(
      meetings.updateMeeting(owner, mid, { latitude: 44 }),
    ).rejects.toThrow("LOCATION_LOCKED");
    const c = await meetings.challenge(alice, mid, "check-out");
    const r = await meetings.mark(alice, mid, "check-out", {
      challenge: c.challenge,
      geo: geo(),
    });
    const again = await meetings.mark(alice, mid, "check-out", {
      challenge: c.challenge,
      geo: geo(),
    });
    expect(String(r.attendance.check_out_at)).toBe(
      String(again.attendance.check_out_at),
    );
  });
  it("close blocks codes, creates no fictional departure; no manual endpoint", async () => {
    await meetings.updateMeeting(owner, mid, { status: "CLOSED" });
    await expect(meetings.qr(owner, mid)).rejects.toThrow("MEETING_CLOSED");
    const row = (
      await db.query(
        "SELECT * FROM attendance WHERE meeting_id=$1 AND user_id=$2",
        [mid, bob.id],
      )
    ).rows[0];
    expect(row.check_out_at).toBeNull();
    await expect(
      meetings.updateMeeting(owner, mid, {
        check_out_at: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });
});
describe("tasks and history", () => {
  it("participant submits but cannot self-accept; deadline changes leave history", async () => {
    const t = await tasks.createTask(owner, {
      title: "Исследование",
      assigned_to: alice.id,
      department_id: dept,
      due_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await tasks.transitionTask(alice, t.id, "submit", {
      comment: "Готово",
      result_url: "https://github.com",
    });
    await expect(
      tasks.transitionTask(alice, t.id, "review", { accept: true }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      tasks.transitionTask(owner, t.id, "review", { accept: false }),
    ).rejects.toThrow("COMMENT_REQUIRED");
    await tasks.transitionTask(owner, t.id, "review", {
      accept: false,
      comment: "Добавить источники",
    });
    await tasks.updateTask(owner, t.id, {
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    });
    const detail = await tasks.taskDetail(owner, t.id);
    expect(detail.events.some((e: any) => e.event === "UPDATED")).toBe(true);
    await tasks.transitionTask(alice, t.id, "submit", {});
    await tasks.transitionTask(owner, t.id, "review", { accept: true });
    expect((await tasks.taskDetail(alice, t.id)).accepted_at).toBeTruthy();
  });
  it("private task hidden from unrelated user; unsafe links rejected", async () => {
    const t = await tasks.createTask(owner, {
      title: "Личное",
      assigned_to: owner.id,
      due_at: new Date().toISOString(),
    });
    await expect(tasks.taskDetail(bob, t.id)).rejects.toThrow("NOT_FOUND");
    await expect(
      tasks.transitionTask(owner, t.id, "submit", {
        result_url: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
  });
});
describe("feedback anonymity and access", () => {
  it("anonymous row, API and audit contain no author link; duplicate key creates no second text", async () => {
    const key = id(),
      text = "Уникальный анонимный текст";
    await feedback.sendFeedback(alice, mid, {
      mode: "ANONYMOUS",
      comment: text,
      idempotency_key: key,
    });
    await feedback.sendFeedback(alice, mid, {
      mode: "ANONYMOUS",
      comment: text,
      idempotency_key: key,
    });
    const rows = (
      await db.query("SELECT * FROM feedback WHERE comment=$1", [text])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].author_user_id).toBeNull();
    expect(rows[0].created_at).toBeUndefined();
    expect((await feedback.listFeedback(owner))[0].author_name).toBeNull();
    expect(await feedback.listFeedback(alice)).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT 1 FROM audit_log WHERE action LIKE '%submit%' OR after_data::text LIKE $1",
          ["%" + text + "%"],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("named feedback linked; processors cannot rewrite text", async () => {
    await feedback.sendFeedback(bob, mid, {
      mode: "NAMED",
      comment: "Спасибо",
      idempotency_key: id(),
    });
    const r = (await feedback.listFeedback(owner)).find(
      (r: any) => r.mode === "NAMED",
    )!;
    expect(r.author_user_id).toBe(bob.id);
    await expect(
      feedback.processFeedback(owner, r.id, {
        status: "PROCESSED",
        comment: "Подмена",
      }),
    ).rejects.toThrow();
    await expect(
      feedback.processFeedback(alice, r.id, { status: "PROCESSED" }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
describe("reports", () => {
  it("only own data, missing checkout distinguished, cancelled meetings excluded", async () => {
    const r = await report(bob, new URLSearchParams());
    expect(r.rows.every((r: any) => r.user_id === bob.id)).toBe(true);
    expect(r.rows.some((r: any) => r.result === "MISSING_CHECK_OUT")).toBe(
      true,
    );
    expect(r.metrics.absent).toBe(0);
    const p = meetingPayload();
    const cancelled = (await meetings.createMeeting(owner, p)).id;
    await meetings.updateMeeting(owner, cancelled, { status: "CANCELLED" });
    expect(
      (await report(bob, new URLSearchParams())).rows.some(
        (r: any) => r.meeting_id === cancelled,
      ),
    ).toBe(false);
    await expect(report(bob, new URLSearchParams(), true)).rejects.toThrow(
      "FORBIDDEN",
    );
  });
  it("zero denominator stays explicit", async () => {
    await transaction(async (tx) => {
      expect(await allowed(tx, bob, "reports.export")).toBe(false);
    });
    const r = await report(bob, new URLSearchParams({ from: "2099-01-01" }));
    expect(r.metrics.required).toBe(0);
    expect(r.metrics.visited).toBe(0);
  });
});

describe("simplified attendance timing", () => {
  it("derives times on the server and ignores obsolete custom windows", async () => {
    const payload = meetingPayload();
    const meetingId = (await meetings.createMeeting(owner, payload)).id;
    const saved = await meetings.meeting(db, owner, meetingId);
    expect(new Date(saved.registration_open_at).getTime()).toBe(
      new Date(payload.starts_at).getTime() - 10 * 60000,
    );
    expect(saved.registration_close_at).toBeNull();
    expect(saved.checkout_close_at).toBeNull();
    expect(saved.late_after_minutes).toBe(15);
  });
  it("allows geoverified departure after closing and legacy deadlines without QR", async () => {
    const meetingId = (await meetings.createMeeting(owner, meetingPayload()))
      .id;
    const token = (await meetings.qr(owner, meetingId)).token;
    const arrival = await meetings.challenge(alice, meetingId, "check-in");
    await meetings.mark(alice, meetingId, "check-in", {
      challenge: arrival.challenge,
      token,
      geo: geo(),
    });
    await meetings.updateMeeting(owner, meetingId, { status: "CLOSED" });
    await db.query(
      "UPDATE meetings SET registration_open_at=now()-interval '3 hours',registration_close_at=now()-interval '2 hours',checkout_close_at=now()-interval '1 hour' WHERE id=$1",
      [meetingId],
    );
    await expect(
      meetings.challenge(alice, meetingId, "check-in"),
    ).rejects.toThrow("MEETING_CLOSED");
    const departure = await meetings.challenge(alice, meetingId, "check-out");
    await expect(
      meetings.mark(alice, meetingId, "check-out", {
        challenge: departure.challenge,
        geo: { ...geo(), latitude: 46 },
      }),
    ).rejects.toThrow("GEO_OUTSIDE_RADIUS");
    const result = await meetings.mark(alice, meetingId, "check-out", {
      challenge: departure.challenge,
      geo: geo(),
    });
    expect(result.attendance.check_out_at).toBeTruthy();
    const repeated = await meetings.mark(alice, meetingId, "check-out", {
      challenge: departure.challenge,
      geo: geo(),
    });
    expect(String(repeated.attendance.check_out_at)).toBe(
      String(result.attendance.check_out_at),
    );
  });
  it("still blocks a departure without arrival and on cancellation", async () => {
    const meetingId = (await meetings.createMeeting(owner, meetingPayload()))
      .id;
    await meetings.updateMeeting(owner, meetingId, { status: "CLOSED" });
    const departure = await meetings.challenge(alice, meetingId, "check-out");
    await expect(
      meetings.mark(alice, meetingId, "check-out", {
        challenge: departure.challenge,
        geo: geo(),
      }),
    ).rejects.toThrow("CHECK_IN_REQUIRED");
    const cancelled = (await meetings.createMeeting(owner, meetingPayload()))
      .id;
    await meetings.updateMeeting(owner, cancelled, { status: "CANCELLED" });
    await expect(
      meetings.challenge(alice, cancelled, "check-out"),
    ).rejects.toThrow("MEETING_CLOSED");
  });
});
