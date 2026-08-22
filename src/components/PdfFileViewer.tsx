"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "./ui";
import { DownloadIcon, XIcon } from "./icons";

export function PdfFileViewer({
  file,
  onClose,
}: {
  file: { key: string; name: string; url?: string } | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [file?.key]);

  const src = file?.url
    ? `${file.url}${file.url.includes("?") ? "&" : "?"}inline=1`
    : null;

  return (
    <Modal open={Boolean(file)} onClose={onClose} title={file?.name ?? "PDF file"} size="editor">
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
        <div className="relative min-h-0 flex-1">
          {!loaded && src && (
            <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
              Loading document…
            </p>
          )}
          {src ? (
            <iframe
              src={src}
              title={file?.name ?? "PDF preview"}
              onLoad={() => setLoaded(true)}
              className={`h-full w-full rounded-lg border border-zinc-200 bg-zinc-50 transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            <div role="alert" className="flex h-full items-center justify-center rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Preview is unavailable for this file.
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {file?.url && (
            <a
              href={file.url}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <DownloadIcon />
              Download
            </a>
          )}
          <Button variant="ghost" onClick={onClose}>
            <XIcon />
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
