"use client";

import type { PresignedPartDto } from "@/lib/api-client";

/**
 * Browser-side upload engine.
 *
 * File data flows directly from the browser to Ceph S3 using presigned
 * URLs; this module never touches application endpoints with payloads.
 *
 * - parts are uploaded with a small concurrency pool (3 by default)
 * - each part retries up to 3 times with exponential backoff
 * - progress is aggregated across completed + in-flight bytes
 * - abort() cancels all in-flight XHRs immediately
 */

export const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 3;

export interface PartProgress {
  loaded: number;
}

function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);

    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };

    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag") ?? "";
        if (!etag) {
          reject(
            new Error(
              "S3 did not return an ETag. Ensure the bucket CORS configuration exposes the ETag header.",
            ),
          );
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`Upload part failed with HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(
        new Error(
          "Network error while uploading to storage. Check that the S3 endpoint is reachable from your browser and CORS is configured.",
        ),
      );
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upload one part with retries. Returns its ETag. */
async function uploadPartWithRetry(
  part: PresignedPartDto,
  blob: Blob,
  contentType: string,
  report: (deltaLoaded: number, deltaTotal: number) => void,
  signal: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      let lastLoaded = 0;
      const etag = await putWithProgress(
        part.url,
        blob,
        { "Content-Type": contentType },
        (loaded) => {
          report(loaded - lastLoaded, 0);
          lastLoaded = loaded;
        },
        signal,
      );
      return etag;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") throw err;
      lastError = err;
      if (attempt < PART_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Part upload failed");
}

export interface MultipartRunOptions {
  file: Blob;
  contentType: string;
  parts: PresignedPartDto[];
  partSize: number;
  /** Called with absolute uploaded bytes whenever progress changes. */
  onProgress: (uploadedBytes: number) => void;
  signal: AbortSignal;
  /** Re-sign URLs when retrying after expiry/failure. */
  resignParts?: (partNumbers: number[]) => Promise<PresignedPartDto[]>;
}

/**
 * Run a full multipart upload of `file` using presigned part URLs.
 * Resolves with the collected ETags in completion order.
 */
export async function runMultipartUpload(opts: MultipartRunOptions): Promise<
  { partNumber: number; etag: string }[]
> {
  const { file, contentType, partSize, signal, onProgress } = opts;
  let planned = opts.parts;
  const results = new Map<number, string>();

  // Bytes already finished (completed parts) never change during a run.
  const completedBytesBefore = (): number =>
    [...results.keys()].reduce((sum, n) => {
      const start = (n - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      return sum + (end - start);
    }, 0);

  // Per-part in-flight byte counters for smooth aggregate progress.
  const inflight = new Map<number, number>();
  const notify = () => {
    let uploaded = completedBytesBefore();
    for (const loaded of inflight.values()) uploaded += loaded;
    onProgress(Math.min(uploaded, file.size));
  };

  const queue = [...planned].sort((a, b) => a.partNumber - b.partNumber);
  const workers: Promise<void>[] = [];

  const runWorker = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const part = queue.shift();
      if (!part) return;

      const start = (part.partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      inflight.set(part.partNumber, 0);

      try {
        const etag = await uploadPartWithRetry(
          part,
          blob,
          contentType,
          (delta) => {
            inflight.set(part.partNumber, (inflight.get(part.partNumber) ?? 0) + delta);
            notify();
          },
          signal,
        );
        results.set(part.partNumber, etag);
        notify();
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") throw err;
        throw err;
      } finally {
        inflight.delete(part.partNumber);
      }
    }
  };

  try {
    for (let i = 0; i < Math.min(PART_CONCURRENCY, queue.length); i++) {
      workers.push(runWorker());
    }
    await Promise.all(workers);
  } catch (err) {
    if ((err as DOMException)?.name !== "AbortError" && opts.resignParts) {
      // Surface a fresh set of URLs so callers can resume cleanly.
      const missing = queue.filter((p) => !results.has(p.partNumber)).map((p) => p.partNumber);
      if (missing.length > 0) {
        try {
          planned = await opts.resignParts(missing);
        } catch {
          /* keep original plan */
        }
      }
    }
    throw err;
  }

  return [...results.entries()]
    .map(([partNumber, etag]) => ({ partNumber, etag }))
    .sort((a, b) => a.partNumber - b.partNumber);
}

/** Single-shot PUT for small files. Returns true on success. */
export function putSingleFile(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);

    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      signal.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with HTTP ${xhr.status}`));
    };
    xhr.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Network error while uploading to storage (check CORS configuration)"));
    };
    xhr.onabort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(file);
  });
}
