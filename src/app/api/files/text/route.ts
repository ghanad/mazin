import { NextRequest, NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { getStorage } from "@/lib/storage";
import { validateKey } from "@/lib/validation/keys";
import { decodeUtf8, encodeText, isTextFile, MAX_TEXT_FILE_BYTES } from "@/lib/text";
import { getMimeType } from "@/lib/mime";
import { ValidationError, NotFoundError } from "@/lib/errors";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBounded(body: WebReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TEXT_FILE_BYTES) throw new ValidationError("The file is too large to view or edit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const rawKey = request.nextUrl.searchParams.get("key");
    if (!rawKey) throw new ValidationError("key is required");
    const key = validateKey(rawKey);
    const storage = getStorage();
    const stat = await storage.head(key);
    if (!stat) throw new NotFoundError("File not found");
    if (stat.size > MAX_TEXT_FILE_BYTES) throw new ValidationError("The file is too large to view or edit");
    // The range is bounded even if the object changes after HEAD.
    const object = await storage.get(key, `bytes=0-${MAX_TEXT_FILE_BYTES - 1}`);
    const total = object.contentRange?.match(/\/(\d+)$/)?.[1];
    if (total && Number(total) > MAX_TEXT_FILE_BYTES) throw new ValidationError("The file is too large to view or edit");
    const contentType = object.contentType ?? stat.contentType;
    if (!isTextFile(key, contentType)) throw new ValidationError("This file is not a supported text file");
    const content = decodeUtf8(await readBounded(object.body));
    const totalSize = Number(object.contentRange?.match(/\/(\d+)$/)?.[1] ?? stat.size);
    return NextResponse.json({ key, content, contentType, size: totalSize, etag: object.etag ?? stat.etag, lastModified: (object.lastModified ?? stat.lastModified).toISOString() });
  } catch (err) { return errorResponse(err); }
}

interface PutTextBody { key?: unknown; content?: unknown; expectedEtag?: unknown }

export async function PUT(request: NextRequest) {
  try {
    const body = await readJson<PutTextBody>(request);
    if (typeof body.key !== "string") throw new ValidationError("key is required");
    if (typeof body.expectedEtag !== "string" || !body.expectedEtag) throw new ValidationError("expectedEtag is required");
    const key = validateKey(body.key);
    const bytes = encodeText(body.content);
    const storage = getStorage();
    const current = await storage.head(key);
    if (!current) throw new NotFoundError("File not found");
    if (!isTextFile(key, current.contentType)) throw new ValidationError("This file is not a supported text file");
    const saved = await storage.putText(key, bytes, current.contentType ?? getMimeType(key), body.expectedEtag);
    return NextResponse.json({ key, content: body.content, contentType: saved.contentType, size: saved.size, etag: saved.etag, lastModified: saved.lastModified.toISOString() });
  } catch (err) { return errorResponse(err); }
}
