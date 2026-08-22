"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getTextFile, saveTextFile, type TextFileResponse } from "@/lib/api-client";
import { Button, Modal } from "./ui";
import { DownloadIcon, PencilIcon, XIcon } from "./icons";
import { useToast } from "./toast";

type ViewerState = "loading" | "ready" | "saving" | "saved" | "error";

export function TextFileViewer({ file, onClose, onSaved }: { file: { key: string; name: string; url?: string } | null; onClose: () => void; onSaved?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<TextFileResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<ViewerState>("loading");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const loadedKey = useRef("");
  const dirty = editing && data?.content !== draft;
  const canEdit = Boolean(data?.etag);

  const load = useCallback(async (key: string, preserveDraft = false) => {
    setState("loading"); setError(""); setConflict(false);
    try {
      const result = await getTextFile(key);
      loadedKey.current = key; setData(result);
      if (!preserveDraft) setDraft(result.content);
      setEditing((current) => preserveDraft && current);
      setState("ready");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the file"); setState("error");
    }
  }, []);

  useEffect(() => {
    if (!file) {
      loadedKey.current = ""; setData(null); setDraft(""); setEditing(false); setError(""); setConflict(false); setState("loading");
      return;
    }
    if (loadedKey.current !== file.key) {
      setData(null); setDraft(""); setEditing(false); void load(file.key);
    }
  }, [file, load]);

  const close = useCallback(() => {
    if (dirty && !window.confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  }, [dirty, onClose]);

  const save = useCallback(async () => {
    if (!file || !data?.etag || !dirty) return;
    setState("saving"); setError("");
    try {
      const result = await saveTextFile(file.key, draft, data.etag);
      setData(result); setDraft(result.content); setEditing(false); setConflict(false); setState("saved");
      toast("success", `Saved “${file.name}”`); onSaved?.();
    } catch (err: unknown) {
      const isConflict = err instanceof ApiError && err.status === 409;
      setConflict(isConflict); setError(isConflict ? "This file changed on the server. Your edits are preserved." : err instanceof Error ? err.message : "Could not save the file"); setState("error");
      toast("error", isConflict ? "Save conflict — your edits were preserved" : "Could not save the file");
    }
  }, [data, dirty, draft, file, onSaved, toast]);

  const reloadLatest = useCallback(() => { if (file) void load(file.key, true); }, [file, load]);

  useEffect(() => {
    if (!file || !editing) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [editing, file, save]);

  return (
    <Modal open={Boolean(file)} onClose={close} title={file?.name ?? "Text file"} dismissable={state !== "saving"} className="max-w-5xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl max-sm:h-[calc(100dvh-2rem)] max-sm:max-w-none">
      <div className="flex max-h-[calc(100dvh-8rem)] flex-col px-5 pb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {data && <span>{data.size.toLocaleString()} bytes{data.lastModified ? ` · ${new Date(data.lastModified).toLocaleString()}` : ""}</span>}
          {state === "saved" && <span className="text-emerald-600" role="status">Saved</span>}
          {data && !canEdit && <span className="text-amber-700">Read-only: the server did not provide an ETag</span>}
        </div>
        {state === "loading" && <p role="status" className="py-16 text-center text-sm text-zinc-500">Loading file…</p>}
        {state === "error" && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><span>{error}</span>{conflict ? <Button size="sm" onClick={reloadLatest}>Reload latest</Button> : data && editing ? <Button size="sm" onClick={() => void save()}>Try save again</Button> : <Button size="sm" onClick={() => file && void load(file.key)}>Retry</Button>}</div>}
        {data && <textarea aria-label={`Contents of ${file?.name}`} readOnly={!editing} value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-[18rem] w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-5 text-zinc-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 read-only:cursor-default read-only:bg-zinc-50" />}
        {error && state !== "error" && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {file?.url && <a href={file.url} download className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"><DownloadIcon />Download</a>}
          {data && !editing && canEdit && <Button onClick={() => { setEditing(true); setState("ready"); }}><PencilIcon />Edit</Button>}
          {editing && <><Button onClick={() => { setDraft(data?.content ?? ""); setEditing(false); setError(""); setConflict(false); setState("ready"); }}>Cancel</Button><Button variant="primary" disabled={state === "saving" || !dirty} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</Button></>}
          <Button variant="ghost" onClick={close}><XIcon />Close</Button>
        </div>
      </div>
    </Modal>
  );
}
