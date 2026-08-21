import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/respond";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/ready
 * Readiness probe with a deep storage check (HeadBucket). Returns 503 when
 * the S3/RGW backend is unreachable or credentials are rejected.
 */
export async function GET() {
  try {
    await getStorage().checkReadiness();
    return NextResponse.json({ status: "ok", storage: "ready" });
  } catch (err) {
    const response = errorResponse(err);
    return NextResponse.json(
      { status: "unavailable", error: "storage not ready" },
      { status: 503, headers: response.headers },
    );
  } finally {
    logger.debug("readiness probe executed");
  }
}
