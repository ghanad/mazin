import type { ReadableStream as WebReadableStream } from "node:stream/web";

/** A file or folder entry as exposed to the UI/API layer. */
export interface StorageEntry {
  /** Full key within the bucket. Folders never carry a trailing slash here. */
  key: string;
  name: string;
  type: "file" | "folder";
  /** Bytes; null for folders. */
  size: number | null;
  lastModified: string | null;
  etag?: string;
}

export interface ListResult {
  prefix: string;
  entries: StorageEntry[];
}

export interface SearchHit extends StorageEntry {
  /** Parent folder path without trailing slash ("" = bucket root). */
  folder: string;
}

export interface SearchResult {
  query: string;
  prefix: string;
  hits: SearchHit[];
  /** True when the scan stopped early because a cap was reached. */
  truncated: boolean;
}

export interface ObjectStat {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
  contentType?: string;
}

export interface GetObjectResult {
  status: 200 | 206;
  body: WebReadableStream<Uint8Array> | null;
  contentLength?: number;
  contentType?: string;
  contentRange?: string;
  etag?: string;
  lastModified?: Date;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface ProgressInfo {
  total: number;
  processed: number;
}

/**
 * Lightweight storage boundary. Version 1 ships only the S3/Ceph RGW
 * implementation, but keeping the UI and API handlers behind this interface
 * makes a future Local/NFS provider possible without rewrites.
 */
export interface StorageService {
  /** List one folder level (immediate children), folders before files. */
  list(prefix: string): Promise<ListResult>;

  /**
   * Case-insensitive substring search across every object under `prefix`
   * (recursively, all depths). Matches file and folder names; results are
   * capped so huge buckets cannot stall the request.
   */
  search(query: string, prefix?: string): Promise<SearchResult>;

  stat(key: string): Promise<ObjectStat | null>;
  exists(key: string): Promise<boolean>;

  /**
   * Stream an object. When `rangeHeader` is provided it is forwarded to the
   * backend so only the requested bytes travel over the wire.
   */
  get(key: string, rangeHeader?: string): Promise<GetObjectResult>;

  /** Metadata only — must not transfer the object body. */
  head(key: string): Promise<ObjectStat | null>;

  deleteFile(key: string): Promise<void>;

  /** Recursively delete every object under `prefix` (inclusive). */
  deleteFolder(prefix: string, onProgress?: (p: ProgressInfo) => void): Promise<number>;

  createFolder(prefix: string): Promise<void>;

  /** Copy + delete semantics for a single object. */
  renameFile(sourceKey: string, targetKey: string): Promise<void>;

  /** Copy + delete every object under a prefix. Not atomic by nature. */
  renameFolder(
    sourcePrefix: string,
    targetPrefix: string,
    onProgress?: (p: ProgressInfo) => void,
  ): Promise<number>;

  createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }>;

  presignParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<{ parts: PresignedPart[]; expiresInSeconds: number }>;

  completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]): Promise<{ etag?: string }>;

  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  presignPut(key: string, contentType: string): Promise<{ url: string; expiresInSeconds: number }>;

  /** Deep readiness check (e.g. HeadBucket). Throws when unavailable. */
  checkReadiness(): Promise<void>;
}
