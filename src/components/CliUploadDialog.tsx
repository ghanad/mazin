"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  buildCurlScript,
  buildPythonCommand,
  SMALL_FILE_LIMIT_MIB,
  UPLOAD_SCRIPT_PATH,
  type CliCommandOptions,
} from "@/lib/cli/commands";
import { CheckIcon, CopyIcon, DownloadIcon } from "./icons";
import { Button, Modal } from "./ui";

type Tab = "python" | "curl";

export interface CliUploadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Folder currently open in the UI ("" = bucket root). */
  prefix: string;
  /**
   * Overrides window.location.origin. Used by tests (SSR) and lets embedders
   * pin the advertised server URL behind proxies.
   */
  serverUrl?: string;
}

/** Copy text to the clipboard with a legacy fallback, mirroring FileBrowser. */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error("copy rejected"));
    } catch (err) {
      reject(err instanceof Error ? err : new Error("copy failed"));
    }
  });
}

/**
 * "CLI Upload" dialog: ready-to-run commands for uploading files from Linux
 * servers. The commands target the folder the user currently has open and
 * never contain credentials — uploads authenticate through short-lived
 * presigned URLs minted at run time.
 */
export function CliUploadDialog({ open, onClose, prefix, serverUrl }: CliUploadDialogProps) {
  const [tab, setTab] = useState<Tab>("python");
  const [origin, setOrigin] = useState(serverUrl ?? "");
  const [copied, setCopied] = useState<Tab | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!open || serverUrl) return;
    setOrigin(window.location.origin);
  }, [open, serverUrl]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const options: CliCommandOptions = { serverUrl: origin, prefix };
  const pythonCommand = buildPythonCommand(options);
  const curlScript = buildCurlScript(options);

  const handleCopy = useCallback(
    (target: Tab, text: string) => {
      copyText(text).then(
        () => {
          setCopied(target);
          if (copiedTimer.current) clearTimeout(copiedTimer.current);
          copiedTimer.current = setTimeout(() => setCopied(null), 2000);
        },
        () => setCopied(null),
      );
    },
    [],
  );

  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "python" ? "curl" : "python";
    setTab(next);
    document.getElementById(`cli-tab-${next}`)?.focus();
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="CLI Upload" className="max-w-xl sm:max-w-2xl">
      <p className="px-5 pb-3 text-sm leading-relaxed text-zinc-600">
        Upload files from any Linux server with <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs">curl</code>{" "}
        or the bundled Python&nbsp;3 script. Files are transferred{" "}
        <strong className="font-medium text-zinc-800">directly to storage</strong> using presigned URLs,
        so the Linux host must be able to reach the Ceph/S3 endpoint over HTTPS.
      </p>

      {/* Tabs */}
      <div role="tablist" aria-label="CLI upload method" className="flex gap-1 border-b border-zinc-200 px-5">
        {(["python", "curl"] as const).map((t) => (
          <button
            key={t}
            id={`cli-tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`cli-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={onTabKeyDown}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t === "python" ? "Python" : "curl"}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted (inactive one hidden) so commands remain
          stable copy targets and assistive tech sees a complete tablist. */}
      <div
        id="cli-panel-python"
        role="tabpanel"
        aria-labelledby="cli-tab-python"
        hidden={tab !== "python"}
        className="px-5 pb-4 pt-3"
      >
        <p className="mb-2 text-xs text-zinc-500">
          Standard library only — no <code className="font-mono">pip install</code> needed.
          Handles large files automatically via multipart upload with retries and abort cleanup.
        </p>
        <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800">
          <code>{pythonCommand}</code>
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => handleCopy("python", pythonCommand)}>
            {copied === "python" ? <CheckIcon /> : <CopyIcon />}
            {copied === "python" ? "Copied" : "Copy command"}
          </Button>
          <a
            href={UPLOAD_SCRIPT_PATH}
            download="file-server-upload.py"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3.5 text-sm font-medium text-zinc-700 transition-colors select-none hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:pointer-events-none disabled:opacity-50"
          >
            <DownloadIcon />
            Download script
          </a>
        </div>
        {origin && (
          <p className="mt-2 truncate text-xs text-zinc-400" title={`${origin}${UPLOAD_SCRIPT_PATH}`}>
            Script URL: <span className="font-mono">{origin}{UPLOAD_SCRIPT_PATH}</span>
          </p>
        )}
      </div>

      <div
        id="cli-panel-curl"
        role="tabpanel"
        aria-labelledby="cli-tab-curl"
        hidden={tab !== "curl"}
        className="px-5 pb-4 pt-3"
      >
        <ul className="mb-2 list-inside list-disc space-y-0.5 text-xs leading-relaxed text-zinc-500">
          <li>
            Requires <code className="font-mono">jq</code> to parse the JSON response.
          </li>
          <li>
            Single-request PUTs only: works when the API answers{" "}
            <code className="font-mono">mode: &quot;single&quot;</code> — up to{" "}
            <strong className="font-medium text-zinc-700">{SMALL_FILE_LIMIT_MIB}&nbsp;MiB</strong>. For larger
            files it exits with an error pointing to the Python script.
          </li>
        </ul>
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800">
          <code>{curlScript}</code>
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => handleCopy("curl", curlScript)}>
            {copied === "curl" ? <CheckIcon /> : <CopyIcon />}
            {copied === "curl" ? "Copied" : "Copy script"}
          </Button>
        </div>
      </div>

      <p className="border-t border-zinc-100 px-5 pb-4 pt-3 text-xs text-zinc-400">
        Commands above target{" "}
        {prefix ? (
          <>the current folder (<span className="font-mono text-zinc-500">{prefix.replace(/\/+$/, "")}</span>). </>
        ) : (
          <>the bucket root. </>
        )}
        Edit <code className="font-mono">FILE</code>/<code className="font-mono">--file</code> before running. No
        authentication is required yet; anyone with network access can upload.
      </p>
    </Modal>
  );
}
