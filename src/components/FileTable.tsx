"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import type { Entry } from "@/types";
import { isPdfFile, isTextFile } from "@/lib/mime";
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  LinkIcon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
} from "./icons";

/* ---------- Row action menu ---------- */

export interface MenuAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export function RowMenu({ actions, entryName }: { actions: MenuAction[]; entryName: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = actions.length * 34 + 12;
    let top = rect.bottom + 4;
    let left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 4);
    }
    if (left < 8) left = 8;
    setPosition({ top, left });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", () => setOpen(false), { once: true, passive: true });
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Actions for ${entryName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
          open ? "bg-zinc-200/70 text-zinc-700" : ""
        }`}
      >
        <MoreVerticalIcon />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${entryName}`}
          style={{ top: position.top, left: position.left }}
          className="animate-rise-in fixed z-40 w-[180px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-950/10"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                action.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none ${
                action.danger
                  ? "text-red-600 hover:bg-red-50"
                  : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <span className="shrink-0 text-zinc-400 [&>svg]:h-4 [&>svg]:w-4">{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Table ---------- */

export interface FileTableProps {
  entries: Entry[];
  onOpenFolder: (entry: Entry) => void;
  onDownload: (entry: Entry) => void;
  onCopyUrl: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onOpenText: (entry: Entry) => void;
  onOpenPdf: (entry: Entry) => void;
}

export function FileTable({
  entries,
  onOpenFolder,
  onDownload,
  onCopyUrl,
  onRename,
  onDelete,
  onOpenText,
  onOpenPdf,
}: FileTableProps) {
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left">
          <th scope="col" className="sticky top-0 z-10 bg-white pb-2 pl-4 pr-3 font-medium text-xs uppercase tracking-wide text-zinc-400">
            Name
          </th>
          <th scope="col" className="sticky top-0 z-10 hidden w-28 bg-white pb-2 px-3 font-medium text-xs uppercase tracking-wide text-zinc-400 sm:table-cell">
            Size
          </th>
          <th scope="col" className="sticky top-0 z-10 hidden w-36 bg-white pb-2 px-3 font-medium text-xs uppercase tracking-wide text-zinc-400 md:table-cell">
            Modified
          </th>
          <th scope="col" className="sticky top-0 z-10 w-28 bg-white pb-2 pl-3 pr-4">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <TableRow
            key={entry.key}
            entry={entry}
            onOpenFolder={onOpenFolder}
            onDownload={onDownload}
            onCopyUrl={onCopyUrl}
            onRename={onRename}
            onDelete={onDelete}
            onOpenText={onOpenText}
            onOpenPdf={onOpenPdf}
          />
        ))}
      </tbody>
    </table>
  );
}

function TableRow({
  entry,
  onOpenFolder,
  onDownload,
  onCopyUrl,
  onRename,
  onDelete,
  onOpenText,
  onOpenPdf,
}: {
  entry: Entry;
} & Omit<FileTableProps, "entries">) {
  const isFolder = entry.type === "folder";
  const canViewText = !isFolder && isTextFile(entry.key);
  const canViewPdf = !isFolder && isPdfFile(entry.key);

  const actions: MenuAction[] = isFolder
    ? [
        { label: "Open", icon: <FolderIcon />, onSelect: () => onOpenFolder(entry) },
        { label: "Rename", icon: <PencilIcon />, onSelect: () => onRename(entry) },
        { label: "Delete", icon: <TrashIcon />, onSelect: () => onDelete(entry), danger: true },
      ]
    : [
        ...(canViewText ? [{ label: "View", icon: <EyeIcon />, onSelect: () => onOpenText(entry) }] : []),
        ...(canViewPdf ? [{ label: "View", icon: <EyeIcon />, onSelect: () => onOpenPdf(entry) }] : []),
        { label: "Download", icon: <DownloadIcon />, onSelect: () => onDownload(entry) },
        { label: "Copy URL", icon: <LinkIcon />, onSelect: () => onCopyUrl(entry) },
        { label: "Rename", icon: <PencilIcon />, onSelect: () => onRename(entry) },
        { label: "Delete", icon: <TrashIcon />, onSelect: () => onDelete(entry), danger: true },
      ];

  return (
    <tr
      className="group border-b border-zinc-100 transition-colors last:border-b-0 hover:bg-zinc-50"
      onDoubleClick={() => {
        if (isFolder) onOpenFolder(entry);
      }}
    >
      <td className="py-0 pl-4 pr-3">
        <div className="flex min-w-0 items-center gap-2.5 py-2">
          {isFolder ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50">
              <FolderIcon width={17} height={17} className="text-blue-500" />
            </span>
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100">
              <FileIcon width={16} height={16} className="text-zinc-400" />
            </span>
          )}
          {isFolder ? (
            <button
              onClick={() => onOpenFolder(entry)}
              className="min-w-0 truncate rounded text-left font-medium text-zinc-800 transition-colors hover:text-blue-700 hover:underline hover:decoration-blue-300 hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
              title={entry.name}
            >
              {entry.name}
            </button>
          ) : (
            <a
              href={entry.url ?? "#"}
              download
              onClick={(event) => {
                if (!entry.url) event.preventDefault();
              }}
              className="min-w-0 truncate rounded text-left text-zinc-800 transition-colors hover:text-blue-700 hover:underline hover:decoration-blue-300 hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
              title={entry.name}
            >
              {entry.name}
            </a>
          )}
        </div>
      </td>
      <td className="hidden py-0 px-3 sm:table-cell">
        <span className="tabular-nums text-zinc-500">
          {isFolder ? "—" : formatBytes(entry.size)}
        </span>
      </td>
      <td className="hidden py-0 px-3 md:table-cell">
        <time
          dateTime={entry.lastModified ?? undefined}
          title={entry.lastModified ? formatDateTime(entry.lastModified) : undefined}
          className="tabular-nums text-zinc-500"
        >
          {formatDate(entry.lastModified)}
        </time>
      </td>
      <td className="py-1.5 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {(canViewText || canViewPdf) && (
            <button
              onClick={() => (canViewPdf ? onOpenPdf(entry) : onOpenText(entry))}
              aria-label={`View ${entry.name}`}
              title="View"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-all hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 group-hover:opacity-100 max-sm:opacity-100"
            >
              <EyeIcon />
            </button>
          )}
          {!isFolder && (
            <button
              onClick={() => onDownload(entry)}
              aria-label={`Download ${entry.name}`}
              title="Download"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-all hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 group-hover:opacity-100 max-sm:opacity-100"
            >
              <DownloadIcon />
            </button>
          )}
          <RowMenu actions={actions} entryName={entry.name} />
        </div>
      </td>
    </tr>
  );
}
