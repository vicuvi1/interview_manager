"use client";

import { colorBg } from "@/lib/colors";
import { statusColor, statusLabel } from "@/lib/status";
import { useStatusSettings } from "@/lib/use-status-settings";
import { cn } from "@/lib/utils";

/** A status pill that respects the admin's custom label + color for each status. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { labels, colors } = useStatusSettings();
  const color = statusColor(status, colors);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        className,
      )}
      style={{ backgroundColor: colorBg(color, 0.12), color, boxShadow: `inset 0 0 0 1px ${colorBg(color, 0.3)}` }}
    >
      {statusLabel(status, labels)}
    </span>
  );
}
