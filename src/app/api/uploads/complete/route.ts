import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { MAX_PARTS } from "@/lib/uploads/parts";
import { validateKey } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteBody {
  key?: string;
  uploadId?: string;
  parts?: { partNumber?: number; etag?: string }[];
}

/**
 * POST /api/uploads/complete
 * Finalizes a multipart upload with the collected part ETags.
 * The upload is NOT complete (and the file not visible) until this succeeds.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<CompleteBody>(request);
    if (!body.key || !body.uploadId) {
      throw new ValidationError("key and uploadId are required");
    }
    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      throw new ValidationError("parts must be a non-empty array");
    }
    if (body.parts.length > MAX_PARTS) {
      throw new ValidationError(`parts exceeds the maximum of ${MAX_PARTS}`);
    }

    const mapped = body.parts.map((p, index) => {
      if (
        typeof p?.partNumber !== "number" ||
        p.partNumber < 1 ||
        p.partNumber > MAX_PARTS ||
        typeof p?.etag !== "string" ||
        p.etag.trim() === ""
      ) {
        throw new ValidationError(`parts[${index}] must contain partNumber and etag`);
      }
      return { partNumber: p.partNumber, etag: p.etag.trim() };
    });

    const key = validateKey(body.key);
    const result = await getStorage().completeMultipartUpload(key, body.uploadId, mapped);
    return NextResponse.json({ ok: true, etag: result.etag });
  } catch (err) {
    return errorResponse(err);
  }
}
