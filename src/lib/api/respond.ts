import { NextResponse } from "next/server";
import { ConfigError } from "@/lib/env";
import {
  ConflictError,
  NotFoundError,
  RangeNotSatisfiableError,
  StorageError,
  ValidationError,
} from "@/lib/errors";
import { describeS3Error, logger } from "@/lib/logger";

/**
 * Uniform JSON error responses. Client-visible messages never include
 * credentials, endpoints or stack traces; details go to server logs only.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json(
      { error: err.message, ...(err.details ?? {}) },
      { status: 409 },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof RangeNotSatisfiableError) {
    return NextResponse.json({ error: err.message }, { status: 416 });
  }
  if (err instanceof ConfigError) {
    logger.error("configuration error", { message: err.message });
    return NextResponse.json(
      { error: "Server storage is not configured correctly" },
      { status: 500 },
    );
  }
  if (err instanceof StorageError) {
    return NextResponse.json(
      { error: err.message || "Storage operation failed" },
      { status: 502 },
    );
  }

  // Unknown error (including AWS SDK ServiceExceptions).
  logger.error("unhandled api error", describeS3Error(err));
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NoSuchBucket" || name === "NoSuchEndpoint") {
    return NextResponse.json(
      { error: "Storage bucket is unavailable" },
      { status: 502 },
    );
  }
  if (
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch" ||
    name === "AccessDenied"
  ) {
    return NextResponse.json(
      { error: "Storage credentials were rejected by the backend" },
      { status: 502 },
    );
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
