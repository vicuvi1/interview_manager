"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  closeOnBackdrop = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Close when the backdrop is clicked. Off by default so a stray outside
   *  click can't dismiss a form mid-edit — use the ✕ or Escape to close. */
  closeOnBackdrop?: boolean;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const prevFocus = React.useRef<HTMLElement | null>(null);
  // Keep the latest onClose without making it an effect dependency — otherwise
  // the inline `onClose={() => …}` most callers pass would re-run the focus
  // effect on every parent re-render (e.g. realtime reloads) and yank the
  // cursor back to the first field mid-typing.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Remember what was focused so we can restore it when the dialog closes.
    prevFocus.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];

    // Move focus into the dialog (first field, else the panel itself).
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap Tab within the dialog.
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && idx <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && idx === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const prev = prevFocus.current;
      if (prev && prev.isConnected) prev.focus();
    };
    // Only re-run when the dialog opens/closes — not on every parent re-render.
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "flex max-h-[90dvh] w-full max-w-lg animate-fade-in flex-col rounded-t-2xl border border-white/[0.08] bg-[#13131a] outline-none sm:rounded-2xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <h3 id={titleId} className="text-sm font-medium text-[#f0f0f5]">{title}</h3>
            {description ? (
              <p id={descId} className="mt-0.5 text-[12px] text-white/40">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
