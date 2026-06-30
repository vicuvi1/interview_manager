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
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-[13px] text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}
