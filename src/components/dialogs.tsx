"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertIcon } from "./icons";
import { Button, Modal } from "./ui";

/* ---------- Confirm dialog ---------- */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="flex items-start gap-3 px-5 pb-2 pt-2">
        {destructive && <AlertIcon width={20} height={20} className="mt-0.5 shrink-0 text-red-500" />}
        <div className="min-w-0 text-sm leading-relaxed text-zinc-600">{message}</div>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
          data-autofocus
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- Prompt dialog (new folder / rename) ---------- */

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel = "Save",
  onSubmit,
  onCancel,
  busy = false,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    // Select the basename (without extension) for quick renaming.
    queueMicrotask(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const dot = initialValue.lastIndexOf(".");
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
  }, [open, initialValue]);

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (trimmed && !busy) onSubmit(trimmed);
        }}
      >
        <div className="px-5 pb-1 pt-1">
          <label htmlFor="prompt-input" className="mb-1.5 block text-sm text-zinc-600">
            {label}
          </label>
          <input
            id="prompt-input"
            ref={inputRef}
            data-autofocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            dir="auto"
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <Button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
