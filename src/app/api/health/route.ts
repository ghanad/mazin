import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Liveness probe. Only reports that the application itself is running —
 * it intentionally does not touch S3 so a storage outage never causes
 * pod restarts.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
