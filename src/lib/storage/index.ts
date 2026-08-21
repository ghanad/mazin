import { getConfig } from "@/lib/env";
import { createS3Client } from "@/lib/s3/client";
import { S3StorageService } from "./s3-service";
import type { StorageService } from "./types";

let instance: StorageService | null = null;

/**
 * Lazily-instantiated storage singleton. Lazy so that `next build` and
 * container startup never require credentials — only actual requests do.
 */
export function getStorage(): StorageService {
  if (!instance) {
    const cfg = getConfig();
    instance = new S3StorageService(createS3Client(), cfg.s3Bucket);
  }
  return instance;
}

/** Test helper. */
export function setStorage(service: StorageService | null): void {
  instance = service;
}

export type { StorageService } from "./types";
