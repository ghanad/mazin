import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { joinKey, normalizePrefix, validateName } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateFolderBody {
  prefix?: string;
  name?: string;
}

/**
 * POST /api/folders
 * Creates a folder by writing the zero-byte placeholder object `name/`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<CreateFolderBody>(request);
    if (!body.name) throw new ValidationError("Folder name is required");
    const name = validateName(body.name, "folder name");
    const prefix = normalizePrefix(body.prefix);
    const markerKey = joinKey(prefix, name) + "/";

    const storage = getStorage();
    if (await storage.exists(markerKey)) {
      throw new ConflictError(`A folder named "${name}" already exists`, { exists: true });
    }
    await storage.createFolder(markerKey);
    logger.info("folder created", { key: markerKey });
    return NextResponse.json({ ok: true, key: markerKey.replace(/\/$/, "") });
  } catch (err) {
    return errorResponse(err);
  }
}
