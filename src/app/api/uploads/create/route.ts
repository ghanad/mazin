import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { getConfig } from "@/lib/env";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { DEFAULT_MIME } from "@/lib/mime";
import { getStorage } from "@/lib/storage";
import {
  SMALL_FILE_THRESHOLD,
  computePartSize,
  partNumbersFor,
} from "@/lib/uploads/parts";
import { joinKey, normalizePrefix, validateName } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateUploadBody {
  prefix?: string;
  name?: string;
  size?: number;
  contentType?: string;
  overwrite?: boolean;
}

/**
 * POST /api/uploads/create
 *
 * Prepares a direct browser -> Ceph upload:
 * - small files: one presigned PUT URL
 * - large files: CreateMultipartUpload + presigned URLs for every part
 *
 * The file data never travels through this application.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<CreateUploadBody>(request);
    if (!body.name) throw new ValidationError("name is required");
    if (typeof body.size !== "number" || !Number.isFinite(body.size) || body.size < 0) {
      throw new ValidationError("size must be a non-negative number");
    }

    const name = validateName(body.name, "file name");
    const prefix = normalizePrefix(body.prefix);
    const key = joinKey(prefix, name);
    const contentType = body.contentType?.trim() || DEFAULT_MIME;
    const cfg = getConfig();
    const storage = getStorage();

    if (!body.overwrite && (await storage.exists(key))) {
      throw new ConflictError(`A file named "${name}" already exists`, { exists: true });
    }

    if (body.size <= SMALL_FILE_THRESHOLD) {
      const { url, expiresInSeconds } = await storage.presignPut(key, contentType);
      logger.info("upload prepared (single)", { key, size: body.size });
      return NextResponse.json({
        mode: "single" as const,
        key,
        url,
        expiresInSeconds,
      });
    }

    const configuredBytes = cfg.uploadPartSizeMb * 1024 * 1024;
    const partSize = computePartSize(body.size, configuredBytes);
    const numbers = partNumbersFor(body.size, partSize);

    const { uploadId } = await storage.createMultipartUpload(key, contentType);
    const { parts, expiresInSeconds } = await storage.presignParts(key, uploadId, numbers);

    logger.info("upload prepared (multipart)", {
      key,
      size: body.size,
      parts: parts.length,
      partSize,
    });

    return NextResponse.json({
      mode: "multipart" as const,
      key,
      uploadId,
      partSize,
      parts,
      expiresInSeconds,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
