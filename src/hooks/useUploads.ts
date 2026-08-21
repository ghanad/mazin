"use client";

import { useCallback, useRef, useState } from "react";
import {
  abortUpload,
  completeUpload,
  createUpload,
  presignParts,
} from "@/lib/api-client";
import {
  putSingleFile,
  runMultipartUpload,
} from "@/lib/upload/client";

export type UploadState =
  | "preparing"
  | "uploading"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  state: UploadState;
  uploaded: number;
  error?: string;
}

interface EngineEntry {
  id: string;
  name: string;
  size: number;
  prefix: string;
  file: File;
  contentType: string;
  state: UploadState;
  /** Set when the user requests cancellation mid-flight. */
  cancelRequested?: boolean;
  uploaded: number;
  error?: string;
  key?: string;
  uploadId?: string;
  partSize?: number;
  completedParts: { partNumber: number; etag: string }[];
  controller?: AbortController;
}

let nextId = 1;

export interface UploadsApi {
  uploads: UploadItem[];
  addFiles: (files: FileList | File[], prefix: string) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  activeCount: number;
}

/**
 * Manages the upload queue.
 *
 * One file uploads at a time (with up to three concurrent S3 parts inside
 * it) to keep bandwidth predictable on internal networks. Failed or
 * cancelled items stay visible until dismissed; failed multipart uploads
 * resume from already-completed parts on retry.
 */
export function useUploads(onComplete: () => void): UploadsApi {
  const engine = useRef<EngineEntry[]>([]);
  const runningRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [display, setDisplay] = useState<UploadItem[]>([]);

  const sync = useCallback(() => {
    setDisplay(
      engine.current.map((e) => ({
        id: e.id,
        name: e.name,
        size: e.size,
        state: e.state,
        uploaded: e.uploaded,
        error: e.error,
      })),
    );
  }, []);

  const runEntry = useCallback(
    async (entry: EngineEntry): Promise<void> => {
      const controller = new AbortController();
      entry.controller = controller;
      entry.error = undefined;
      entry.state = entry.uploadId ? "uploading" : "preparing";
      sync();

      try {
        let singleUrl: string | undefined;
        if (!entry.uploadId) {
          const plan = await createUpload({
            prefix: entry.prefix,
            name: entry.name,
            size: entry.size,
            contentType: entry.contentType,
          });

          // The user may have cancelled while we were preparing.
          if (entry.cancelRequested) {
            if (plan.mode === "multipart") {
              abortUpload(plan.key, plan.uploadId).catch(() => {});
            }
            return;
          }

          entry.key = plan.key;
          if (plan.mode === "multipart") {
            entry.uploadId = plan.uploadId;
            entry.partSize = plan.partSize;
          } else {
            singleUrl = plan.url;
          }
          entry.state = "uploading";
          sync();
        }

        const key = entry.key ?? entry.name;

        if (entry.uploadId && entry.partSize) {
          // Resume path: re-sign every part that is not completed yet.
          const doneNumbers = new Set(entry.completedParts.map((p) => p.partNumber));
          const totalParts = Math.ceil(entry.size / entry.partSize);
          const missing = Array.from({ length: totalParts }, (_, i) => i + 1).filter(
            (n) => !doneNumbers.has(n),
          );

          let signed: { partNumber: number; url: string }[] = [];
          if (missing.length > 0) {
            const res = await presignParts(key, entry.uploadId, missing);
            signed = res.parts;
          }

          const baseUploaded = entry.completedParts.reduce((sum, p) => {
            const start = (p.partNumber - 1) * entry.partSize!;
            const end = Math.min(start + entry.partSize!, entry.size);
            return sum + (end - start);
          }, 0);
          entry.state = "uploading";
          entry.uploaded = baseUploaded;
          sync();

          const parts = await runMultipartUpload({
            file: entry.file,
            contentType: entry.contentType,
            parts: signed,
            partSize: entry.partSize,
            signal: controller.signal,
            onProgress: (uploaded) => {
              entry.uploaded = uploaded;
              sync();
            },
          });

          entry.completedParts = [...entry.completedParts, ...parts].sort(
            (a, b) => a.partNumber - b.partNumber,
          );
          entry.state = "completing";
          sync();

          await completeUpload(key, entry.uploadId, entry.completedParts);
        } else if (singleUrl) {
          // Small file: one presigned PUT straight to S3.
          entry.state = "uploading";
          entry.uploaded = 0;
          sync();
          await putSingleFile(
            singleUrl,
            entry.file,
            entry.contentType,
            (loaded) => {
              entry.uploaded = loaded;
              sync();
            },
            controller.signal,
          );
        } else {
          throw new Error("Upload could not be prepared");
        }

        entry.state = "completed";
        entry.uploaded = entry.size;
        sync();
        onCompleteRef.current();
      } catch (err) {
        const e = err as Error;
        if (e?.name === "AbortError") {
          if (entry.key && entry.uploadId) {
            abortUpload(entry.key, entry.uploadId).catch(() => {});
          }
          entry.state = "cancelled";
        } else {
          entry.state = "failed";
          entry.error = e?.message ?? "Upload failed";
        }
        sync();
      }
    },
    [sync],
  );

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        // Only freshly queued items. Failed uploads are retried exclusively
        // through the user-facing retry() action.
        const next = engine.current.find((e) => e.state === "preparing");
        if (!next) break;
        await runEntry(next);
      }
    } finally {
      runningRef.current = false;
    }
  }, [runEntry]);

  const addFiles = useCallback(
    (files: FileList | File[], prefix: string) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      for (const file of list) {
        engine.current.push({
          id: String(nextId++),
          name: file.name,
          size: file.size,
          prefix,
          file,
          contentType: file.type || "application/octet-stream",
          state: "preparing",
          uploaded: 0,
          completedParts: [],
        });
      }
      sync();
      setTimeout(() => void pump(), 0);
    },
    [pump, sync],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = engine.current.find((e) => e.id === id);
      if (!entry || entry.state !== "failed") return;
      entry.state = "preparing";
      entry.error = undefined;
      sync();
      setTimeout(() => void pump(), 0);
    },
    [pump, sync],
  );

  const cancel = useCallback(
    (id: string) => {
      const entry = engine.current.find((e) => e.id === id);
      if (!entry) return;
      if (
        entry.state === "completed" ||
        entry.state === "cancelled" ||
        entry.state === "failed"
      ) {
        engine.current = engine.current.filter((e) => e.id !== id);
        sync();
        return;
      }
      if (entry.state === "preparing") {
        // Mark cancelled and abort so the running entry stops at the next
        // checkpoint (runEntry cleans up the multipart session in S3).
        entry.cancelRequested = true;
        entry.state = "cancelled";
        sync();
      }
      entry.controller?.abort();
    },
    [sync],
  );

  const dismiss = useCallback(
    (id: string) => {
      engine.current = engine.current.filter((e) => e.id !== id);
      sync();
    },
    [sync],
  );

  const clearFinished = useCallback(() => {
    engine.current = engine.current.filter(
      (e) =>
        e.state !== "completed" && e.state !== "cancelled" && e.state !== "failed",
    );
    sync();
  }, [sync]);

  const activeCount = display.filter(
    (u) =>
      u.state === "preparing" || u.state === "uploading" || u.state === "completing",
  ).length;

  return {
    uploads: display,
    addFiles,
    retry,
    cancel,
    dismiss,
    clearFinished,
    activeCount,
  };
}
