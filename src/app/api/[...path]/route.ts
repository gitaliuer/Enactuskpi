import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { authenticate, login, activate, sessionCookie } from "@/server/auth";
import {
  AppError,
  fail,
  digest,
  uuid,
  permissions,
  requireOwner,
  csv,
  rateLimit,
  audit,
} from "@/server/core";
import * as meetings from "@/server/meetings";
import * as tasks from "@/server/tasks";
import * as feedback from "@/server/feedback";
import * as management from "@/server/management";
import { report } from "@/server/reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
};
async function handle(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname.replace(/^\/api\//, "").split("/");
    const [a, b, c] = path;
    const method = req.method;
    const origin = process.env.APP_ORIGIN;
    if (!origin) throw new Error("APP_ORIGIN is required");
    if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
      throw new Error("HTTPS origin required in production");
    if (method !== "GET") {
      if (req.headers.get("origin") !== new URL(origin).origin)
        fail("FORBIDDEN", 403);
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        fail("INVALID_INPUT", 415);
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > 65536) fail("INVALID_INPUT", 413);
    }
    const body = async () => {
      const text = await req.text();
      if (Buffer.byteLength(text) > 65536) fail("INVALID_INPUT", 413);
      try {
        return JSON.parse(text);
      } catch {
        fail("INVALID_INPUT");
      }
    };
    const json = (data: unknown, status = 200) =>
      NextResponse.json(data, { status, headers });
    if (a === "auth" && b === "login" && method === "POST") {
      const p = z
        .object({
          login: z.string().min(1).max(50),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(await body()); // Header must be provided by trusted deployment, not accepted as identity.
      await rateLimit(db, "login-global", 300, 60);
      const token = await login(p.login, p.password);
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie(token, origin));
      return response;
    }
    if (a === "auth" && b === "activate" && method === "POST") {
      await rateLimit(db, "activation-global", 100, 60);
      const p = z
        .object({
          token: z.string().max(200).optional(),
          password: z.string(),
        })
        .strict()
        .parse(await body());
      if (!p.token) fail("ACTIVATION_CODE_REQUIRED");
      if (!/^[A-Za-z0-9_-]{43}$/.test(p.token!)) fail("ACTIVATION_INVALID");
      if (p.password.length < 12) fail("PASSWORD_TOO_SHORT");
      if (p.password.length > 256) fail("PASSWORD_TOO_LONG");
      await activate(p.token!, p.password);
      return json({ ok: true });
    }
    const u = await authenticate(req);
    if (a === "auth" && b === "logout" && method === "POST") {
      const token = req.cookies.get("enactus_session")?.value ?? "";
      await db.query(
        "UPDATE sessions SET revoked_at=now() WHERE token_hash=$1",
        [digest(token)],
      );
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie("", origin));
      return response;
    }
    if (a === "me" && !b && method === "GET") {
      const grants = (
        await db.query(
          "SELECT id,permission,scope_type,scope_id FROM permission_grants WHERE grantee_id=$1 AND revoked_at IS NULL",
          [u.id],
        )
      ).rows;
      return json({ ...u, grants, permissions });
    }
    if (a === "me" && b === "attendance" && method === "GET")
      return json(await report(u, new URLSearchParams({ user: u.id })));
    if (a === "users") {
      if (!b && method === "GET") return json(await management.users(u));
      if (!b && method === "POST")
        return json(await management.invite(u, await body()), 201);
      if (b && method === "PATCH") {
        uuid.parse(b);
        return json(await management.updateUser(u, b, await body()));
      }
    }
    if (a === "departments") {
      if (!b && method === "GET") return json(await management.departments(u));
      if (!b && method === "POST")
        return json(await management.createDepartment(u, await body()), 201);
      if (b && method === "PATCH") {
        uuid.parse(b);
        return json(await management.updateDepartment(u, b, await body()));
      }
    }
    if (a === "permissions") {
      requireOwner(u);
      if (!b && method === "GET")
        return json(
          (
            await db.query(
              "SELECT p.*,u.display_name FROM permission_grants p JOIN users u ON u.id=p.grantee_id WHERE revoked_at IS NULL ORDER BY u.display_name",
            )
          ).rows,
        );
      if (!b && method === "POST")
        return json(await management.grant(u, await body()), 201);
      if (b && method === "DELETE") {
        uuid.parse(b);
        return json(await management.revoke(u, b));
      }
    }
    if (a === "meetings") {
      if (!b && method === "GET") return json(await meetings.listMeetings(u));
      if (!b && method === "POST")
        return json(await meetings.createMeeting(u, await body()), 201);
      if (b) {
        uuid.parse(b);
        if (!c && method === "GET")
          return json(
            await meetings.meetingView(u, await meetings.meeting(db, u, b)),
          );
        if (!c && method === "PATCH")
          return json(await meetings.updateMeeting(u, b, await body()));
        if (c === "qr" && method === "GET")
          return json(await meetings.qr(u, b));
        if (c === "challenge" && method === "POST") {
          const p = z
            .object({ action: z.enum(["check-in", "check-out"]) })
            .strict()
            .parse(await body());
          return json(await meetings.challenge(u, b, p.action));
        }
        if ((c === "check-in" || c === "check-out") && method === "POST")
          return json(await meetings.mark(u, b, c, await body()));
        if (c === "feedback" && method === "POST")
          return json(await feedback.sendFeedback(u, b, await body()), 201);
      }
    }
    if (a === "tasks") {
      if (!b && method === "GET") return json(await tasks.listTasks(u));
      if (!b && method === "POST")
        return json(await tasks.createTask(u, await body()), 201);
      if (b) {
        uuid.parse(b);
        if (!c && method === "GET") return json(await tasks.taskDetail(u, b));
        if (!c && method === "PATCH")
          return json(await tasks.updateTask(u, b, await body()));
        if (
          ["start", "submit", "review", "comment"].includes(c) &&
          method === "POST"
        )
          return json(await tasks.transitionTask(u, b, c, await body()));
      }
    }
    if (a === "feedback") {
      if (!b && method === "GET") return json(await feedback.listFeedback(u));
      if (b && c === "status" && method === "PATCH") {
        uuid.parse(b);
        return json(await feedback.processFeedback(u, b, await body()));
      }
    }
    if (a === "reports" && method === "GET") {
      for (const key of ["user", "department", "meeting"])
        if (req.nextUrl.searchParams.has(key))
          uuid.parse(req.nextUrl.searchParams.get(key));
      for (const key of ["from", "to"])
        if (
          req.nextUrl.searchParams.has(key) &&
          !Number.isFinite(Date.parse(req.nextUrl.searchParams.get(key)!))
        )
          fail("INVALID_INPUT");
      const exporting = req.nextUrl.searchParams.get("format") === "csv";
      const r = await report(u, req.nextUrl.searchParams, exporting);
      if (exporting) {
        await audit(db, u, "report.export", "report", null);
        return new NextResponse(
          csv(
            req.nextUrl.searchParams.get("kind") === "metrics"
              ? r.summary
              : r.rows,
          ),
          {
            headers: {
              ...headers,
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="enactus-attendance.csv"',
            },
          },
        );
      }
      return json(r);
    }
    if (a === "audit" && method === "GET") {
      requireOwner(u);
      return json(
        (
          await db.query(
            "SELECT a.*,u.display_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY created_at DESC LIMIT 200",
          )
        ).rows,
      );
    }
    return json({ error: "NOT_FOUND" }, 404);
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json(
        { error: e.code, details: e.details },
        { status: e.status, headers },
      );
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          fields: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400, headers },
      );
    if ((e as { code?: string }).code === "23505")
      return NextResponse.json({ error: "CONFLICT" }, { status: 409, headers });
    if ((e as { code?: string }).code === "23503")
      return NextResponse.json(
        { error: "INVALID_INPUT" },
        { status: 400, headers },
      ); // Do not log payload, token, SQL parameters or feedback text.
    console.error(
      "Request failed:",
      e instanceof Error ? e.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "SERVER_ERROR" },
      { status: 500, headers },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
