"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry, SortDirection, SortField } from "@/types";
import { Breadcrumbs } from "./Breadcrumbs";
import { ConfirmDialog, PromptDialog } from "./dialogs";
import { AlertIcon, FolderIcon, UploadIcon } from "./icons";
import { FileTable } from "./FileTable";
import { ToastProvider, useToast } from "./toast";
import { Toolbar } from "./Toolbar";
import { UploadPanel } from "./UploadPanel";
import { Button } from "./ui";
import { useFileListing } from "@/hooks/useFileListing";
import { useUploads } from "@/hooks/useUploads";

type DialogState =
  | { kind: "delete"; entry: Entry }
  | { kind: "rename"; entry: Entry }
  | { kind: "newFolder" }
  | null;

export default function FileBrowser({ bucket }: { bucket: string | null }) {
  return (
    <ToastProvider>
      <FileBrowserInner bucket={bucket} />
    </ToastProvider>
  );
}

function FileBrowserInner({ bucket }: { bucket: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefix = searchParams.get("prefix") ?? "";

  const toast = useToast();
  const listing = useFileListing(prefix);
  const uploads = useUploads(listing.reload);

  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Clear the filter when navigating to a different folder.
  useEffect(() => {
    setQuery("");
  }, [prefix]);

  /* ---------- navigation ---------- */

  const navigate = useCallback(
    (targetPrefix: string) => {
      router.push(targetPrefix ? `/?prefix=${encodeURIComponent(targetPrefix)}` : "/");
    },
    [router],
  );

  const openFolder = useCallback((entry: Entry) => navigate(entry.key), [navigate]);

  const downloadFile = useCallback((entry: Entry) => {
    if (entry.url) window.location.href = entry.url;
  }, []);

  const copyUrl = useCallback(
    (entry: Entry) => {
      if (!entry.url) return;
      const fallback = () => {
        const area = document.createElement("textarea");
        area.value = entry.url!;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        try {
          document.execCommand("copy");
          toast("success", "Link copied to clipboard");
        } catch {
          toast("error", "Could not copy the link");
        }
        document.body.removeChild(area);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(entry.url)
          .then(() => toast("success", "Link copied to clipboard"))
          .catch(fallback);
      } else {
        fallback();
      }
    },
    [toast],
  );

  /* ---------- mutations ---------- */

  const deleteEntry = useCallback(
    async (entry: Entry) => {
      setBusy(true);
      try {
        await fetch("/api/files", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: entry.key, type: entry.type }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Delete failed (${res.status})`);
          }
        });
        toast("success", `Deleted "${entry.name}"`);
        setDialog(null);
        listing.reload();
      } catch (err) {
        toast("error", (err as Error).message || "Delete failed");
      } finally {
        setBusy(false);
      }
    },
    [listing, toast],
  );

  const submitRename = useCallback(
    async (newName: string, overwrite = false) => {
      if (dialog?.kind !== "rename") return;
      const entry = dialog.entry;
      setBusy(true);
      try {
        const res = await fetch("/api/files/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: entry.key, to: newName, isFolder: entry.type === "folder", overwrite }),
        });
        if (res.status === 409) {
          setBusy(false);
          const proceed = window.confirm(
            `"${newName}" already exists. Replace it? The existing ${entry.type} will be overwritten.`,
          );
          if (proceed) await submitRename(newName, true);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Rename failed (${res.status})`);
        }
        toast("success", `Renamed to "${newName}"`);
        setDialog(null);
        setBusy(false);
        listing.reload();
      } catch (err) {
        setBusy(false);
        toast("error", (err as Error).message || "Rename failed");
      }
    },
    [dialog, listing, toast],
  );

  const submitNewFolder = useCallback(
    async (name: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix, name }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not create folder (${res.status})`);
        }
        toast("success", `Folder "${name}" created`);
        setDialog(null);
        setBusy(false);
        listing.reload();
      } catch (err) {
        setBusy(false);
        toast("error", (err as Error).message || "Could not create folder");
      }
    },
    [prefix, listing, toast],
  );

  /* ---------- derived listing ---------- */

  const visibleEntries = useMemo(() => {
    let list = listing.entries;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      switch (sortField) {
        case "size":
          return ((a.size ?? 0) - (b.size ?? 0)) * dir || a.name.localeCompare(b.name);
        case "modified":
          return (
            (new Date(a.lastModified ?? 0).getTime() - new Date(b.lastModified ?? 0).getTime()) *
              dir || a.name.localeCompare(b.name)
          );
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [listing.entries, query, sortField, sortDirection]);

  /* ---------- drag & drop ---------- */

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) uploads.addFiles(e.dataTransfer.files, prefix);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [prefix, uploads]);

  /* ---------- render ---------- */

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">File Server</h1>
          {bucket && (
            <span
              title={`S3 bucket: ${bucket}`}
              className="max-w-[180px] truncate rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-500"
            >
              {bucket}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 md:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Breadcrumbs prefix={prefix} />
        </div>

        <Toolbar
          onUploadClick={() => fileInputRef.current?.click()}
          onFilesSelected={(files) => uploads.addFiles(files, prefix)}
          onNewFolder={() => setDialog({ kind: "newFolder" })}
          query={query}
          onQueryChange={setQuery}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={(field, direction) => {
            setSortField(field);
            setSortDirection(direction);
          }}
          onRefresh={listing.reload}
          refreshing={listing.refreshing}
          fileInputRef={fileInputRef}
        />

        <section
          aria-label="Files and folders"
          aria-busy={listing.loading}
          className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white"
        >
          {listing.loading ? (
            <SkeletonRows />
          ) : listing.error ? (
            <ErrorState message={listing.error} onRetry={listing.reload} />
          ) : visibleEntries.length === 0 ? (
            query ? (
              <EmptyFilterState query={query} onClear={() => setQuery("")} />
            ) : (
              <EmptyFolderState
                onUpload={() => fileInputRef.current?.click()}
                onNewFolder={() => setDialog({ kind: "newFolder" })}
              />
            )
          ) : (
            <FileTable
              entries={visibleEntries}
              onOpenFolder={openFolder}
              onDownload={downloadFile}
              onCopyUrl={copyUrl}
              onRename={(entry) => setDialog({ kind: "rename", entry })}
              onDelete={(entry) => setDialog({ kind: "delete", entry })}
            />
          )}
        </section>

        {!listing.loading && !listing.error && visibleEntries.length > 0 && (
          <p className="mt-2 px-1 text-xs text-zinc-400">
            {visibleEntries.length} item{visibleEntries.length === 1 ? "" : "s"}
            {query && ` matching “${query}”`}
          </p>
        )}
      </main>

      {/* Drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-600/5 p-8">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-blue-400 bg-white/95 px-12 py-10 shadow-lg">
            <UploadIcon width={28} height={28} className="text-blue-600" />
            <p className="text-sm font-medium text-zinc-800">Drop files to upload here</p>
            <p className="text-xs text-zinc-500">They will be uploaded to the current folder</p>
          </div>
        </div>
      )}

      <UploadPanel
        uploads={uploads.uploads}
        activeCount={uploads.activeCount}
        onRetry={uploads.retry}
        onCancel={uploads.cancel}
        onDismiss={uploads.dismiss}
        onClearFinished={uploads.clearFinished}
      />

      {/* Dialogs */}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          busy={busy}
          destructive
          title={dialog.entry.type === "folder" ? "Delete folder" : "Delete file"}
          confirmLabel="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => void deleteEntry(dialog.entry)}
          message={
            dialog.entry.type === "folder" ? (
              <>
                Delete the folder <strong className="font-medium text-zinc-900" dir="auto">{dialog.entry.name}</strong> and{" "}
                <strong className="font-medium text-red-700">everything inside it</strong>?
                <br />
                This action cannot be undone.
              </>
            ) : (
              <>
                Delete <strong className="font-medium text-zinc-900" dir="auto">{dialog.entry.name}</strong>?
                <br />
                This action cannot be undone.
              </>
            )
          }
        />
      )}

      {dialog?.kind === "rename" && (
        <PromptDialog
          open
          busy={busy}
          title={dialog.entry.type === "folder" ? "Rename folder" : "Rename file"}
          label="New name"
          initialValue={dialog.entry.name}
          confirmLabel="Rename"
          onCancel={() => setDialog(null)}
          onSubmit={(value) => void submitRename(value)}
        />
      )}

      {dialog?.kind === "newFolder" && (
        <PromptDialog
          open
          busy={busy}
          title="New folder"
          label="Folder name"
          confirmLabel="Create"
          onCancel={() => setDialog(null)}
          onSubmit={(value) => void submitNewFolder(value)}
        />
      )}
    </div>
  );
}

/* ---------- states ---------- */

function SkeletonRows() {
  return (
    <div role="status" aria-label="Loading files" className="divide-y divide-zinc-100">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="skeleton h-8 w-8 rounded-md" />
          <div className="skeleton h-3.5 rounded" style={{ width: `${28 + ((i * 13) % 34)}%` }} />
          <div className="ml-auto skeleton hidden h-3 w-16 rounded sm:block" />
          <div className="skeleton hidden h-3 w-20 rounded md:block" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 px-5 py-10 sm:flex-row sm:items-center">
      <AlertIcon width={22} height={22} className="shrink-0 text-red-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">Could not load this folder</p>
        <p className="mt-0.5 break-words text-sm text-zinc-500">{message}</p>
      </div>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}

function EmptyFolderState({
  onUpload,
  onNewFolder,
}: {
  onUpload: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100">
        <FolderIcon width={20} height={20} className="text-zinc-400" />
      </span>
      <p className="text-sm font-medium text-zinc-800">This folder is empty</p>
      <p className="text-sm text-zinc-500">Upload a file or create a folder.</p>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" onClick={onUpload}>
          <UploadIcon /> Upload files
        </Button>
        <Button onClick={onNewFolder}>New folder</Button>
      </div>
    </div>
  );
}

function EmptyFilterState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm text-zinc-600">
        No items match <span className="font-medium text-zinc-900">“{query}”</span>
      </p>
      <button
        onClick={onClear}
        className="rounded text-sm text-blue-600 hover:text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        Clear filter
      </button>
    </div>
  );
}
