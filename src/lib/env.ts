/**
 * Server-side environment configuration.
 *
 * All values are read lazily so that `next build` works without real
 * credentials present (they are only required at runtime).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  /** Public base URL used to build stable direct download links. */
  appBaseUrl?: string;
  /** Multipart upload part size in MiB (>= 8). */
  uploadPartSizeMb: number;
  /** Presigned URL lifetime in seconds (max 604800 = 7 days). */
  presignExpirySeconds: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function str(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.trim();
}

function requiredStr(name: string): string {
  const value = str(name);
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value.replace(/\/+$/, "");
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = str(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return Math.min(max, Math.max(min, parsed));
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"].filter(
    (name) => !str(name),
  );
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "See .env.example for the full configuration reference.",
    );
  }

  cached = {
    s3Endpoint: requiredStr("S3_ENDPOINT"),
    s3Region: str("S3_REGION", "us-east-1")!,
    s3AccessKey: requiredStr("S3_ACCESS_KEY"),
    s3SecretKey: requiredStr("S3_SECRET_KEY"),
    s3Bucket: requiredStr("S3_BUCKET"),
    s3ForcePathStyle: str("S3_FORCE_PATH_STYLE", "true")!.toLowerCase() !== "false",
    appBaseUrl: str("APP_BASE_URL")?.replace(/\/+$/, ""),
    // 64 MiB parts -> ~160 parts for a 10 GB file; well within the S3
    // limit of 10,000 parts while keeping request overhead low.
    uploadPartSizeMb: int("UPLOAD_PART_SIZE_MB", 64, 8, 5120),
    presignExpirySeconds: int("PRESIGN_EXPIRY_SECONDS", 24 * 60 * 60, 60, 7 * 24 * 60 * 60),
    logLevel: (str("LOG_LEVEL", "info") as AppConfig["logLevel"]) ?? "info",
  };

  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = null;
}
