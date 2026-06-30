import * as React from "react";

import { cn } from "@/lib/utils";

export type Tone = "amber" | "green" | "red" | "slate" | "indigo" | "blue";

const tones: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
};

export function Badge({
  tone = "slate",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const statusTone: Record<string, Tone> = {
  pending: "amber",
  approved: "green",
  scheduled: "blue",
  completed: "green",
  rejected: "red",
  cancelled: "slate",
};

export const paymentTone: Record<string, Tone> = {
  paid: "green",
  unpaid: "red",
};
