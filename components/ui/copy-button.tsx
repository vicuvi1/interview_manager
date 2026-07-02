"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/** A tiny icon button that copies `value` to the clipboard and flashes a check. */
export function CopyButton({
  value,
  title = "Copy",
  className,
}: {
  value: string | null | undefined;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for older/insecure contexts.
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* give up silently */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (!value) return null;

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : title}
      aria-label={copied ? "Copied" : title}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/80",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#34d399]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
