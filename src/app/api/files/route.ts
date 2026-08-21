import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { getBaseUrl } from "@/lib/http/base-url";
import { encodeKeyToPath } from "@/lib/http/path";
import { ValidationError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { normalizePrefix, validateKey } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/files?prefix=ISO/Linux
 * Lists the immediate children of a prefix. Folders come before files.
 */
export async function GET(request: NextRequest) {
  try {
    const storage = getStorage();
    const prefixParam = request.nextUrl.searchParams.get("prefix");
    const prefix = normalizePrefix(prefixParam);
    const base = getBaseUrl(request);

    const result = await storage.list(prefix);
    const entries = result.entries.map((entry) => ({
      ...entry,
      url:
        entry.type === "file"
          ? `${base}/files/${encodeKeyToPath(entry.key)}`
          : undefined,
    }));

    return NextResponse.json({ prefix, entries });
  } catch (err) {
    return errorResponse(err);
  }
}

interface DeleteBody {
  key?: string;
  type?: "file" | "folder";
}

/**
 * DELETE /api/files
 * Body: { key: string, type: "file" | "folder" }
 * Folders are deleted recursively after the UI has asked for confirmation.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await readJson<DeleteBody>(request);
    if (!body.key || typeof body.key !== "string") {
      throw new ValidationError("key is required");
    }

    const storage = getStorage();

    if (body.type === "folder") {
      const prefix = normalizePrefix(body.key);
      if (!prefix) {
        throw new ValidationError("Refusing to delete the bucket root");
      }
      const deleted = await storage.deleteFolder(prefix);
      return NextResponse.json({ ok: true, deleted });
    }

    const key = validateKey(body.key);
    if (key.endsWith("/")) {
      throw new ValidationError("Use type=folder to delete a folder");
    }
    await storage.deleteFile(key);
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (err) {
    return errorResponse(err);
  }
}


