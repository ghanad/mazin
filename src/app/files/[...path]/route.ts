import type { NextRequest } from "next/server";
import { DEFAULT_MIME } from "@/lib/mime";
import { contentDispositionFor, isForwardableRange } from "@/lib/http/path";
import { NotFoundError, RangeNotSatisfiableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";
import { validateKey } from "@/lib/validation/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function resolveKey(context: RouteContext): Promise<string> {
  const { path } = await context.params;
  const segments = path ?? [];
  if (segments.length === 0) throw new NotFoundError("Object not found");
  // Next.js has already decoded each segment exactly once.
  return validateKey(segments.join("/"));
}

function baseHeaders(key: string): Headers {
  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", contentDispositionFor(key));
  headers.set("Cache-Control", "private, no-cache");
  // Ask reverse proxies (nginx etc.) not to buffer large binary streams.
  headers.set("X-Accel-Buffering", "no");
  return headers;
}

/**
 * GET /files/<key...>
 *
 * Streams the object straight from Ceph S3 to the client. Range requests are
 * forwarded to S3 so only the requested bytes are ever transferred — required
 * for remote ISO mounting (BMC/iLO/virtualization) and resumable downloads.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  let key: string;
  try {
    key = await resolveKey(context);
  } catch {
    return new Response("Not found\n", { status: 404 });
  }

  try {
    const rangeHeader = request.headers.get("range");
    const forwardRange =
      rangeHeader && isForwardableRange(rangeHeader) ? rangeHeader.trim() : undefined;

    const obj = await getStorage().get(key, forwardRange);
    const headers = baseHeaders(key);
    headers.set("Content-Type", obj.contentType ?? DEFAULT_MIME);
    if (obj.contentLength !== undefined) {
      headers.set("Content-Length", String(obj.contentLength));
    }
    if (obj.contentRange) {
      headers.set("Content-Range", obj.contentRange);
    }
    if (obj.etag) headers.set("ETag", obj.etag);
    if (obj.lastModified) headers.set("Last-Modified", obj.lastModified.toUTCString());

    return new Response(obj.body as unknown as ReadableStream, {
      status: obj.status,
      headers,
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response("Not found\n", { status: 404 });
    }
    if (err instanceof RangeNotSatisfiableError) {
      return new Response("Requested range not satisfiable\n", { status: 416 });
    }
    logger.error("download failed", { key, name: (err as Error)?.name });
    return new Response("Storage error\n", { status: 502 });
  }
}

/**
 * HEAD /files/<key...>
 * Returns object metadata without transferring the body. Supports Range
 * semantics (206 + Content-Range) computed locally from the object size.
 */
export async function HEAD(request: NextRequest, context: RouteContext) {
  let key: string;
  try {
    key = await resolveKey(context);
  } catch {
    return new Response(null, { status: 404, headers: { "Content-Length": "0" } });
  }

  try {
    const stat = await getStorage().head(key);
    if (!stat) return new Response(null, { status: 404 });

    const headers = baseHeaders(key);
    headers.set("Content-Type", stat.contentType ?? DEFAULT_MIME);
    if (stat.etag) headers.set("ETag", stat.etag);
    if (stat.lastModified) headers.set("Last-Modified", stat.lastModified.toUTCString());

    const rangeHeader = request.headers.get("range");
    if (rangeHeader && isForwardableRange(rangeHeader)) {
      const size = stat.size;
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())!;
      let start: number;
      let end: number;
      if (match[1] === "") {
        const n = Number.parseInt(match[2], 10);
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = Number.parseInt(match[1], 10);
        end = match[2] === "" ? size - 1 : Math.min(Number.parseInt(match[2], 10), size - 1);
      }
      if (size === 0 || start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(null, { status: 206, headers });
    }

    headers.set("Content-Length", String(stat.size));
    return new Response(null, { status: 200, headers });
  } catch (err) {
    logger.error("HEAD failed", { key, name: (err as Error)?.name });
    return new Response(null, { status: 502 });
  }
}
