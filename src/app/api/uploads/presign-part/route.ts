import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { MAX_PARTS } from "@/lib/uploads/parts";
import { validateKey } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PresignBody {
  key?: string;
  uploadId?: string;
  partNumbers?: number[];
}

/**
 * POST /api/uploads/presign-part
 * Re-signs parts whose URLs expired or were never issued (retry path).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<PresignBody>(request);
    if (!body.key || !body.uploadId || !Array.isArray(body.partNumbers)) {
      throw new ValidationError("key, uploadId and partNumbers are required");
    }
    if (body.partNumbers.length === 0 || body.partNumbers.length > MAX_PARTS) {
      throw new ValidationError(`partNumbers must contain 1..${MAX_PARTS} entries`);
    }
    for (const n of body.partNumbers) {
      if (!Number.isInteger(n) || n < 1 || n > MAX_PARTS) {
        throw new ValidationError(`Invalid partNumber: ${String(n)}`);
      }
    }

    const key = validateKey(body.key);
    const result = await getStorage().presignParts(key, body.uploadId, body.partNumbers);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
