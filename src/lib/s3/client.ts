import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@/lib/env";

/**
 * Build the S3 client used for all storage operations.
 *
 * Ceph RGW compatibility notes baked in here:
 * - path-style addressing by default (virtual-hosted buckets are rarely
 *   configured on internal RGW clusters)
 * - checksum features disabled unless required: older RGW versions reject
 *   the newer x-amz-checksum / streaming-trailer behavior of AWS SDK v3
 */
export function createS3Client(): S3Client {
  const cfg = getConfig();
  return new S3Client({
    endpoint: cfg.s3Endpoint,
    region: cfg.s3Region,
    forcePathStyle: cfg.s3ForcePathStyle,
    credentials: {
      accessKeyId: cfg.s3AccessKey,
      secretAccessKey: cfg.s3SecretKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
