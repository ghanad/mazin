"use client";

import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { UploadItem, UploadState } from "@/hooks/useUploads";
import { AlertIcon, CheckIcon, ChevronRightIcon, SpinnerIcon, XIcon } from "./icons";
import { ProgressBar } from "./ui";

const STATE_LABELS: Record<UploadState, string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  completing: "Completing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function UploadPanel({
  uploads,
  activeCount,
  onRetry,
  onCancel,
  onDismiss,
  onClearFinished,
}: {
  uploads: UploadItem[];
  activeCount: number;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (uploads.length === 0) return null;

  const allDone = activeCount === 0;

  return (
    <aside
      aria-label="Upload progress"
      className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-950/10"
    >
      <header className="flex items-center gap-2 border-b border-zinc-100 px-3.5 py-2.5">
        <h2 className="flex-1 text-sm font-semibold text-zinc-800">
          Uploads
          <span className="ml-1.5 font-normal text-zinc-400">{uploads.length}</span>
        </h2>
        {allDone && (
          <button
            onClick={onClearFinished}
            className="rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
          >
            Clear finished
          </button>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand upload list" : "Collapse upload list"}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
        >
          <ChevronRightIcon
            width={14}
            height={14}
            className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
      </header>

      {!collapsed && (
        <ul className="max-h-[320px] divide-y divide-zinc-100 overflow-y-auto">
          {uploads.map((upload) => (
            <li key={upload.id} className="px-3.5 py-2.5">
              <div className="mb-1.5 flex items-start gap-2">
                <StateGlyph state={upload.state} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800" title={upload.name} dir="auto">
                    {upload.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                    <span
                      className={
                        upload.state === "failed"
                          ? "font-medium text-red-600"
                          : upload.state === "completed"
                            ? "font-medium text-emerald-600"
                            : ""
                      }
                    >
                      {STATE_LABELS[upload.state]}
                    </span>
                    {(upload.state === "uploading" || upload.state === "completed") && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatBytes(upload.uploaded)} / {formatBytes(upload.size)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <PanelActions upload={upload} onRetry={onRetry} onCancel={onCancel} onDismiss={onDismiss} />
              </div>
              <ProgressBar
                value={upload.size > 0 ? (upload.uploaded / upload.size) * 100 : upload.state === "completed" ? 100 : 0}
                state={
                  upload.state === "completed"
                    ? "done"
                    : upload.state === "failed" || upload.state === "cancelled"
                      ? "error"
                      : "active"
                }
              />
              {upload.error && (
                <p className="mt-1.5 text-xs leading-relaxed text-red-600">{upload.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function StateGlyph({ state }: { state: UploadState }) {
  if (state === "completed") {
    return <CheckIcon width={15} height={15} className="mt-0.5 shrink-0 text-emerald-600" />;
  }
  if (state === "failed") {
    return <AlertIcon width={15} height={15} className="mt-0.5 shrink-0 text-red-500" />;
  }
  if (state === "cancelled") {
    return <XIcon width={15} height={15} className="mt-0.5 shrink-0 text-zinc-400" />;
  }
  return <SpinnerIcon width={15} height={15} className="mt-0.5 shrink-0 text-blue-600" />;
}

function PanelActions({
  upload,
  onRetry,
  onCancel,
  onDismiss,
}: {
  upload: UploadItem;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const isActive =
    upload.state === "preparing" || upload.state === "uploading" || upload.state === "completing";

  if (isActive) {
    return (
      <button
        onClick={() => onCancel(upload.id)}
        aria-label={`Cancel upload of ${upload.name}`}
        title="Cancel upload"
        className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
      >
        <XIcon width={14} height={14} />
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {upload.state === "failed" && (
        <button
          onClick={() => onRetry(upload.id)}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
        >
          Retry
        </button>
      )}
      <button
        onClick={() => onDismiss(upload.id)}
        aria-label={`Dismiss ${upload.name}`}
        title="Dismiss"
        className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
      >
        <XIcon width={14} height={14} />
      </button>
    </div>
  );
}
