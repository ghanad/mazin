import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { getBaseUrl } from "@/lib/http/base-url";
import { encodeKeyToPath } from "@/lib/http/path";
import { getStorage } from "@/lib/storage";
import { normalizePrefix } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=…&prefix=…
 * Case-insensitive recursive name search under `prefix` (default: bucket root).
 * Returns file and folder hits with direct download URLs, capped server-side.
 */
export async function GET(request: NextRequest) {
  try {
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (!query) throw new ValidationError("Search query is required");
    if (query.length > 255) throw new ValidationError("Search query is too long");

    const prefix = normalizePrefix(request.nextUrl.searchParams.get("prefix"));
    const base = getBaseUrl(request);

    const result = await getStorage().search(query, prefix);
    const hits = result.hits.map((hit) => ({
      ...hit,
      url:
        hit.type === "file"
          ? `${base}/files/${encodeKeyToPath(hit.key)}`
          : undefined,
    }));

    return NextResponse.json({ ...result, hits });
  } catch (err) {
    return errorResponse(err);
  }
}
