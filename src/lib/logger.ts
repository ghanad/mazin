import { getConfig } from "@/lib/env";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): Level {
  try {
    return getConfig().logLevel;
  } catch {
    return "info";
  }
}

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  const line = meta && Object.keys(meta).length > 0 ? `${message} ${JSON.stringify(meta)}` : message;
  if (level === "error") console.error(`${prefix} ${line}`);
  else if (level === "warn") console.warn(`${prefix} ${line}`);
  else console.log(`${prefix} ${line}`);
}

/**
 * Concise operational logging. Never pass credentials, presigned URLs or
 * full stack traces containing secrets into `meta`.
 */
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};

/** Extract safe fields from an S3 ServiceException for logging. */
export function describeS3Error(err: unknown): Record<string, unknown> {
  if (err && typeof err === "object") {
    const e = err as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    return {
      code: e.name ?? e.Code ?? "unknown",
      httpStatus: e.$metadata?.httpStatusCode,
      message: e.message,
    };
  }
  return { message: String(err) };
}
