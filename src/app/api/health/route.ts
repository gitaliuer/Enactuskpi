import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readiness only: no account data, configuration values, hosts or credentials.
export async function GET() {
  const headers = { "Cache-Control": "no-store, private" };
  try {
    await db.query("SELECT 1");
    return NextResponse.json({ status: "ready" }, { headers });
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers },
    );
  }
}
