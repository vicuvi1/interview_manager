"use client";

import { Check } from "lucide-react";

import { EVENT_COLORS } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** A compact row of color swatches. `null` = default (status color). */
export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        title="Default (status color)"
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] text-white/40 transition-colors",
          !value ? "border-white/60 text-white/70" : "border-white/15 hover:border-white/30",
        )}
      >
        ✕
      </button>
      {EVENT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(c.value)}
          title={c.label}
          style={{ backgroundColor: c.value }}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-[#13131a] transition-all",
            value === c.value ? "ring-white/70" : "ring-transparent hover:ring-white/20",
          )}
        >
          {value === c.value ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
        </button>
      ))}
    </div>
  );
}
