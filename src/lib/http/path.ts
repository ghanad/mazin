import { RangeNotSatisfiableError } from "@/lib/errors";

/**
 * HTTP path <-> S3 key conversion.
 *
 * Rules:
 * - When building URLs, EVERY segment is encoded independently with
 *   encodeURIComponent, then joined with "/". This keeps "/" as a real
 *   separator while correctly escaping spaces, "#", "?", "%", "+", "(" ")"
 *   and all non-ASCII (e.g. Persian) characters.
 * - When reading keys back from [...path] route params, the framework has
 *   already decoded each segment exactly once; we only re-validate.
 */

/** Encode an S3 key into a URL path (no leading slash). */
export function encodeKeyToPath(key: string): string {
  if (!key) return "";
  return key
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** Encode an S3 key into an absolute path with leading slash. */
export function encodeKeyToUrlPath(key: string): string {
  const p = encodeKeyToPath(key);
  return p ? `/${p}` : "/";
}

/**
 * Build the final basename for a Content-Disposition header:
 * RFC 6266/5987 combo with ASCII fallback and UTF-8 encoded value.
 */
export function contentDispositionFor(key: string): string {
  const name = key.split("/").filter(Boolean).pop() ?? "download";
  const asciiFallback =
    name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(name)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "%20");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Parse a Range header into a normalized form we are willing to forward to
 * S3. Returns null when the header is absent or anything we do not support
 * (multi-range, suffix weirdness) — in that case callers serve 200 full.
 *
 * Supported: bytes=a-b, bytes=a-, bytes=-n (single range only).
 */
export function parseRangeHeader(
  header: string | null | undefined,
  objectSize?: number,
): { start: number; end?: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  let start: number;
  let end: number | undefined;

  if (startRaw === "") {
    // suffix range: last N bytes
    const n = Number.parseInt(endRaw, 10);
    if (Number.isNaN(n) || n <= 0) return null;
    if (objectSize !== undefined && objectSize === 0) {
      throw new RangeNotSatisfiableError("Object is empty");
    }
    start = objectSize !== undefined ? Math.max(0, objectSize - n) : 0;
    end = objectSize !== undefined ? objectSize - 1 : undefined;
  } else {
    start = Number.parseInt(startRaw, 10);
    if (endRaw !== "") {
      end = Number.parseInt(endRaw, 10);
      if (end < start) return null;
    }
  }

  if (objectSize !== undefined && start >= objectSize) {
    throw new RangeNotSatisfiableError(
      `Start ${start} is beyond object size ${objectSize}`,
    );
  }

  return { start, end };
}

/**
 * Decide whether a raw Range header should be forwarded to S3.
 * Multi-range or malformed headers are ignored (callers serve 200 full),
 * which matches common server behavior for unsupported ranges.
 */
export function isForwardableRange(header: string | null | undefined): boolean {
  if (!header) return false;
  if (header.includes(",")) return false; // multi-range unsupported -> full GET
  return /^bytes=\d*-\d*$/.test(header.trim()) && !/^bytes=$/.test(header.trim());
}
