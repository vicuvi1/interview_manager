import * as React from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.04] text-white/30">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-[13px] font-medium text-white/70">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-[12px] text-white/40">{description}</p>
      ) : null}
    </div>
  );
}
