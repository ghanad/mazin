"use client";

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { XIcon } from "./icons";

/* ---------- Buttons ---------- */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium " +
  "transition-colors duration-150 select-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 " +
  "disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm",
  secondary:
    "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm",
} as const;

const BUTTON_SIZES = {
  sm: "h-8 px-2.5",
  md: "h-9 px-3.5",
  icon: "h-8 w-8 p-0",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/* ---------- Modal ---------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** When false, Escape and backdrop clicks cannot dismiss the dialog. */
  dismissable?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissable = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog for keyboard users.
    const target =
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      panelRef.current?.querySelector<HTMLElement>("input, button");
    target?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-950/25"
        onClick={dismissable ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise-in relative w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-950/10"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <XIcon />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Progress bar ---------- */

export function ProgressBar({
  value,
  state,
}: {
  value: number; // 0..100
  state: "active" | "done" | "error";
}) {
  const color =
    state === "done" ? "bg-emerald-500" : state === "error" ? "bg-red-500" : "bg-blue-600";
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ease-out ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
