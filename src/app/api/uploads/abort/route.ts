import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { validateKey } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AbortBody {
  key?: string;
  uploadId?: string;
}

/**
 * POST /api/uploads/abort
 * Cancels a multipart upload and cleans up uploaded parts in S3.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<AbortBody>(request);
    if (!body.key || !body.uploadId) {
      throw new ValidationError("key and uploadId are required");
    }
    const key = validateKey(body.key);
    await getStorage().abortMultipartUpload(key, body.uploadId);
    logger.info("upload aborted by user", { key });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
