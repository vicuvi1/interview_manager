import * as React from "react";

import { cn } from "@/lib/utils";

export type Tone = "amber" | "green" | "red" | "slate" | "indigo" | "blue" | "pink" | "purple";

const tones: Record<Tone, string> = {
  amber: "bg-[#f59e0b]/[0.08] text-[#fbbf24] ring-[#f59e0b]/30",
  green: "bg-[#10b981]/[0.08] text-[#34d399] ring-[#10b981]/30",
  red: "bg-[#ef4444]/[0.08] text-[#f87171] ring-[#ef4444]/30",
  slate: "bg-white/[0.04] text-white/50 ring-white/10",
  indigo: "bg-[#6366f1]/[0.08] text-[#a5b4fc] ring-[#6366f1]/30",
  blue: "bg-[#3b82f6]/[0.08] text-[#93c5fd] ring-[#3b82f6]/30",
  pink: "bg-[#ec4899]/[0.08] text-[#f9a8d4] ring-[#ec4899]/30",
  purple: "bg-[#8b5cf6]/[0.08] text-[#c4b5fd] ring-[#8b5cf6]/30",
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset",
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
  scheduled: "indigo",
  completed: "slate",
  rejected: "red",
  cancelled: "red",
};

export const paymentTone: Record<string, Tone> = {
  paid: "green",
  unpaid: "amber",
};
