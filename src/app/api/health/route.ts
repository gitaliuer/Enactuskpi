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
  } catch (error) {
    // Only fixed categories are public; never include exception messages or URLs.
    const code = (error as { code?: string }).code ?? "";
    const reason = [
      "ENOTFOUND",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ETIMEDOUT",
      "ECONNREFUSED",
    ].includes(code)
      ? "DATABASE_NETWORK"
      : [
            "SELF_SIGNED_CERT_IN_CHAIN",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            "CERT_HAS_EXPIRED",
            "DEPTH_ZERO_SELF_SIGNED_CERT",
          ].includes(code)
        ? "DATABASE_TLS"
        : code === "28P01"
          ? "DATABASE_AUTH"
          : "DATABASE_UNAVAILABLE";
    return NextResponse.json(
      { status: "unavailable", reason },
      { status: 503, headers },
    );
  }
}
