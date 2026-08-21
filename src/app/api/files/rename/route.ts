import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import {
  joinKey,
  normalizePrefix,
  parentPathOf,
  validateKey,
  validateName,
} from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RenameBody {
  from?: string;
  to?: string;
  isFolder?: boolean;
  overwrite?: boolean;
}

/**
 * POST /api/files/rename
 * Body: { from, to, isFolder, overwrite? }
 *
 * S3 has no native rename: implemented as copy + delete. Folder renames copy
 * every object under the prefix first and remove the originals afterwards,
 * so a failure leaves the source intact (but is not atomic overall).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<RenameBody>(request);
    if (!body.from || !body.to) throw new ValidationError("from and to are required");

    const storage = getStorage();

    if (body.isFolder) {
      const fromPrefix = normalizePrefix(body.from);
      if (!fromPrefix) throw new ValidationError("Invalid source folder");
      const toName = validateName(
        body.to.split("/").filter(Boolean).pop() ?? "",
        "target name",
      );
      const toPrefix = joinKey(parentPathOf(fromPrefix), toName) + "/";

      if (!body.overwrite && (await storage.exists(toPrefix))) {
        throw new ConflictError(`A folder named "${toName}" already exists`, {
          exists: true,
        });
      }
      const renamed = await storage.renameFolder(fromPrefix, toPrefix);
      logger.info("folder renamed", { from: fromPrefix, to: toPrefix, objects: renamed });
      return NextResponse.json({ ok: true, renamed });
    }

    const fromKey = validateKey(body.from);
    const toName = validateName(body.to.split("/").filter(Boolean).pop() ?? "", "target name");
    const toKey = joinKey(parentPathOf(fromKey), toName);

    if (fromKey === toKey) return NextResponse.json({ ok: true, renamed: 1 });
    if (!body.overwrite && (await storage.exists(toKey))) {
      throw new ConflictError(`A file named "${toName}" already exists`, { exists: true });
    }
    await storage.renameFile(fromKey, toKey);
    return NextResponse.json({ ok: true, renamed: 1 });
  } catch (err) {
    return errorResponse(err);
  }
}
