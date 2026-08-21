import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { getConfig } from "@/lib/env";
import {
  NotFoundError,
  RangeNotSatisfiableError,
  StorageError,
} from "@/lib/errors";
import { describeS3Error, logger } from "@/lib/logger";
import { DEFAULT_MIME } from "@/lib/mime";
import {
  folderNameFromKey,
  normalizePrefix,
  validateKey,
} from "@/lib/validation/keys";
import type {
  GetObjectResult,
  ListResult,
  MultipartPart,
  ObjectStat,
  PresignedPart,
  ProgressInfo,
  StorageEntry,
  StorageService,
} from "./types";

/** Objects above this size are copied via multipart copy (AWS/RGW limit for
 * single CopyObject is 5 GiB; stay well below it). */
const COPY_MULTIPART_THRESHOLD = 512 * 1024 * 1024;
const COPY_PART_SIZE = 128 * 1024 * 1024;
/** Hard cap so a pathological bucket cannot make listing run forever. */
const LIST_SAFETY_CAP = 20_000;
const DELETE_BATCH_SIZE = 1000;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    e?.Code === "NotFound" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

function isRangeNotSatisfiable(err: unknown): boolean {
  const e = err as { name?: string; Code?: string };
  return e?.name === "InvalidRange" || e?.Code === "InvalidRange" || e?.name === "InvalidArgument";
}

function wrapError(err: unknown, operation: string): unknown {
  if (isNotFound(err)) return new NotFoundError("Object not found");
  if (isRangeNotSatisfiable(err)) return new RangeNotSatisfiableError();
  logger.error(`s3 ${operation} failed`, describeS3Error(err));
  const code = (err as { name?: string })?.name ?? "storage_error";
  return new StorageError(`Storage operation failed: ${operation}`, code);
}

export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  private copySource(key: string): string {
    // CopySource must be URL-encoded per segment but keep "/" separators,
    // INCLUDING the trailing slash of folder markers ("a/b/" != "a/b").
    const encoded = key
      .split("/")
      .map((segment) => (segment ? encodeURIComponent(segment) : segment))
      .join("/");
    return `${this.bucket}/${encoded}`;
  }

  async list(prefix: string): Promise<ListResult> {
    const normalized = normalizePrefix(prefix);
    const folders = new Map<string, StorageEntry>();
    const files: StorageEntry[] = [];
    let token: string | undefined;
    let count = 0;

    try {
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: normalized || undefined,
            Delimiter: "/",
            MaxKeys: 1000,
            ContinuationToken: token,
          }),
        );

        for (const cp of res.CommonPrefixes ?? []) {
          if (!cp.Prefix) continue;
          const key = cp.Prefix.endsWith("/") ? cp.Prefix.slice(0, -1) : cp.Prefix;
          folders.set(key, {
            key,
            name: folderNameFromKey(cp.Prefix, normalized),
            type: "folder",
            size: null,
            lastModified: null,
          });
        }

        for (const obj of res.Contents ?? []) {
          if (!obj.Key) continue;
          // Hide the zero-byte marker that represents THIS folder itself.
          if (normalized && obj.Key === normalized) continue;
          if (obj.Key.endsWith("/")) {
            const key = obj.Key.slice(0, -1);
            folders.set(key, {
              key,
              name: folderNameFromKey(obj.Key, normalized),
              type: "folder",
              size: null,
              lastModified: obj.LastModified?.toISOString() ?? null,
            });
            continue;
          }
          files.push({
            key: obj.Key,
            name: obj.Key.slice(normalized.length),
            type: "file",
            size: obj.Size ?? null,
            lastModified: obj.LastModified?.toISOString() ?? null,
            etag: obj.ETag,
          });
        }

        count += (res.Contents?.length ?? 0) + (res.CommonPrefixes?.length ?? 0);
        if (count > LIST_SAFETY_CAP) {
          logger.warn("list hit safety cap; results truncated", { prefix: normalized, cap: LIST_SAFETY_CAP });
          break;
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
    } catch (err) {
      throw wrapError(err, "list");
    }

    const byName = (a: StorageEntry, b: StorageEntry) => a.name.localeCompare(b.name);
    const entries: StorageEntry[] = [...[...folders.values()].sort(byName), ...files.sort(byName)];

    logger.debug("listed prefix", { prefix: normalized, entries: entries.length });
    return { prefix: normalized, entries };
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: validateKey(key) }),
      );
      return {
        key,
        size: res.ContentLength ?? 0,
        lastModified: res.LastModified ?? new Date(0),
        etag: res.ETag,
        contentType: res.ContentType,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw wrapError(err, "head");
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async get(key: string, rangeHeader?: string): Promise<GetObjectResult> {
    const safeKey = validateKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: safeKey,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        }),
      );

      let body: GetObjectResult["body"] = null;
      const raw = res.Body as Readable | undefined;
      if (raw && typeof (raw as Readable).pipe === "function") {
        body = Readable.toWeb(raw) as unknown as GetObjectResult["body"];
      } else if (res.Body) {
        body = res.Body as unknown as GetObjectResult["body"];
      }

      return {
        status: res.ContentRange ? 206 : 200,
        body,
        contentLength: res.ContentLength,
        contentType: res.ContentType ?? DEFAULT_MIME,
        contentRange: res.ContentRange,
        etag: res.ETag,
        lastModified: res.LastModified,
      };
    } catch (err) {
      throw wrapError(err, "get");
    }
  }

  async head(key: string): Promise<ObjectStat | null> {
    return this.stat(key);
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: validateKey(key) }),
      );
      logger.info("deleted object", { key });
    } catch (err) {
      throw wrapError(err, "delete");
    }
  }

  /** List every object key under a prefix (no delimiter), paginated. */
  private async listAllKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          MaxKeys: 1000,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async deleteFolder(prefix: string, onProgress?: (p: ProgressInfo) => void): Promise<number> {
    const normalized = normalizePrefix(prefix);
    if (!normalized) {
      throw new StorageError("Refusing to delete the bucket root");
    }
    let keys: string[];
    try {
      keys = await this.listAllKeys(normalized);
    } catch (err) {
      throw wrapError(err, "list-for-delete");
    }

    let processed = 0;
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      try {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (err) {
        throw wrapError(err, "batch-delete");
      }
      processed += batch.length;
      onProgress?.({ total: keys.length, processed });
    }

    logger.info("deleted folder", { prefix: normalized, objects: processed });
    return processed;
  }

  async createFolder(prefix: string): Promise<void> {
    const normalized = normalizePrefix(prefix);
    if (!normalized) throw new StorageError("Folder name is required");
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: normalized,
          Body: "",
          ContentType: "application/x-directory",
        }),
      );
      logger.info("created folder", { prefix: normalized });
    } catch (err) {
      throw wrapError(err, "create-folder");
    }
  }

  /**
   * Server-side copy that works for any object size:
   * - <= threshold: single CopyObject
   * - larger: multipart copy using UploadPartCopy (RGW supported)
   */
  private async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    const stat = await this.stat(sourceKey);
    if (!stat) throw new NotFoundError(`Source not found: ${sourceKey}`);
    const source = this.copySource(sourceKey);

    if (stat.size <= COPY_MULTIPART_THRESHOLD) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: targetKey,
          CopySource: source,
          MetadataDirective: "COPY",
        }),
      );
      return;
    }

    const partSize = Math.max(COPY_PART_SIZE, Math.ceil(stat.size / 10000));
    const partCount = Math.ceil(stat.size / partSize);
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: targetKey,
        ContentType: stat.contentType ?? DEFAULT_MIME,
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new StorageError("Multipart copy failed to initialize");

    try {
      const parts: MultipartPart[] = [];
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, stat.size) - 1;
        const res = await this.client.send(
          new UploadPartCopyCommand({
            Bucket: this.bucket,
            Key: targetKey,
            CopySource: source,
            CopySourceRange: `bytes=${start}-${end}`,
            PartNumber: partNumber,
            UploadId: uploadId,
          }),
        );
        if (!res.CopyPartResult?.ETag) {
          throw new StorageError(`Multipart copy returned no ETag for part ${partNumber}`);
        }
        parts.push({ partNumber, etag: res.CopyPartResult.ETag });
      }
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: targetKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } catch (err) {
      // Never leave orphaned multipart copies behind.
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: targetKey, UploadId: uploadId }),
        );
      } catch {
        /* best effort */
      }
      throw err;
    }
  }

  async renameFile(sourceKey: string, targetKey: string): Promise<void> {
    const src = validateKey(sourceKey);
    const dst = validateKey(targetKey);
    if (src === dst) return;
    try {
      await this.copyObject(src, dst);
      await this.deleteFile(src);
      logger.info("renamed file", { from: src, to: dst });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof RangeNotSatisfiableError) throw err;
      logger.error("rename file failed", { from: src, to: dst, ...describeS3Error(err) });
      throw err instanceof StorageError ? err : new StorageError("Rename failed");
    }
  }

  async renameFolder(
    sourcePrefix: string,
    targetPrefix: string,
    onProgress?: (p: ProgressInfo) => void,
  ): Promise<number> {
    const src = normalizePrefix(sourcePrefix);
    const dst = normalizePrefix(targetPrefix);
    if (!src || !dst) throw new StorageError("Invalid rename paths");
    if (dst.startsWith(src)) throw new StorageError("Cannot rename a folder into itself");

    let keys: string[];
    try {
      keys = await this.listAllKeys(src);
    } catch (err) {
      throw wrapError(err, "list-for-rename");
    }

    // Phase 1: copy everything first — the source stays intact on failure.
    let processed = 0;
    try {
      for (const key of keys) {
        const relative = key.slice(src.length);
        await this.copyObject(key, dst + relative);
        processed += 1;
        onProgress?.({ total: keys.length, processed });
      }
    } catch (err) {
      logger.error("folder rename failed mid-copy", {
        from: src,
        to: dst,
        copied: processed,
        ...describeS3Error(err),
      });
      throw new StorageError("Folder rename failed; the original folder was left intact");
    }

    // Phase 2: only after all copies succeeded, remove originals.
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }

    logger.info("renamed folder", { from: src, to: dst, objects: processed });
    return processed;
  }

  async createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    try {
      const res = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: validateKey(key),
          ContentType: contentType || DEFAULT_MIME,
        }),
      );
      if (!res.UploadId) throw new StorageError("CreateMultipartUpload returned no UploadId");
      logger.info("multipart upload started", { key });
      return { uploadId: res.UploadId };
    } catch (err) {
      throw wrapError(err, "create-multipart-upload");
    }
  }

  async presignParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<{ parts: PresignedPart[]; expiresInSeconds: number }> {
    const cfg = getConfig();
    const safeKey = validateKey(key);
    const parts: PresignedPart[] = [];
    for (const partNumber of partNumbers) {
      const url = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: safeKey,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: cfg.presignExpirySeconds },
      );
      parts.push({ partNumber, url });
    }
    return { parts, expiresInSeconds: cfg.presignExpirySeconds };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<{ etag?: string }> {
    if (!Array.isArray(parts) || parts.length === 0) {
      throw new StorageError("Complete requires at least one uploaded part");
    }
    try {
      const res = await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: validateKey(key),
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag.replace(/"/g, "") })),
          },
        }),
      );
      logger.info("multipart upload completed", { key, parts: parts.length });
      return { etag: res.ETag };
    } catch (err) {
      throw wrapError(err, "complete-multipart-upload");
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: validateKey(key),
          UploadId: uploadId,
        }),
      );
      logger.info("multipart upload aborted", { key });
    } catch (err) {
      // Aborting an already-completed/aborted upload must not break the UX.
      logger.warn("abort multipart upload failed", { key, ...describeS3Error(err) });
    }
  }

  async presignPut(key: string, contentType: string): Promise<{ url: string; expiresInSeconds: number }> {
    const cfg = getConfig();
    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: validateKey(key),
          ContentType: contentType || DEFAULT_MIME,
        }),
        { expiresIn: cfg.presignExpirySeconds },
      );
      return { url, expiresInSeconds: cfg.presignExpirySeconds };
    } catch (err) {
      throw wrapError(err, "presign-put");
    }
  }

  async checkReadiness(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
