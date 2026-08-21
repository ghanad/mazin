/**
 * Multipart upload arithmetic.
 *
 * S3 constraints: 1..10,000 parts; every part except the last must be >= 5 MiB.
 * We default to 64 MiB parts (~160 parts for a 10 GB file) and automatically
 * grow the part size for very large files so the 10k limit is never hit.
 */

export const MIN_PART_SIZE = 8 * 1024 * 1024; // 8 MiB floor (above S3's 5 MiB)
export const MAX_PARTS = 10_000;
/** Files at or below this size use a single presigned PUT instead of multipart. */
export const SMALL_FILE_THRESHOLD = 32 * 1024 * 1024;

export function computePartSize(fileSize: number, configuredPartSize: number): number {
  let partSize = Math.max(MIN_PART_SIZE, configuredPartSize);
  if (fileSize > partSize * MAX_PARTS) {
    // Grow part size (rounded up to MiB) so the object fits in <= MAX_PARTS.
    partSize = Math.ceil(fileSize / MAX_PARTS / (1024 * 1024)) * 1024 * 1024;
  }
  return partSize;
}

export function computePartCount(fileSize: number, partSize: number): number {
  if (fileSize <= 0) return 1;
  return Math.ceil(fileSize / partSize);
}

export function partNumbersFor(fileSize: number, partSize: number): number[] {
  return Array.from({ length: computePartCount(fileSize, partSize) }, (_, i) => i + 1);
}
