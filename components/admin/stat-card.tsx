import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "amber" | "green" | "blue" | "slate" | "indigo" | "red";

const tones: Record<Tone, string> = {
  amber: "bg-[#f59e0b]/10 text-[#fbbf24]",
  green: "bg-[#10b981]/10 text-[#34d399]",
  blue: "bg-[#3b82f6]/10 text-[#93c5fd]",
  slate: "bg-white/[0.05] text-white/50",
  indigo: "bg-[#6366f1]/10 text-[#a5b4fc]",
  red: "bg-[#ef4444]/10 text-[#f87171]",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          tones[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold leading-tight tabular-nums text-[#f0f0f5]">
          {value}
        </p>
        <p className="mt-0.5 text-[12px] text-white/40">{label}</p>
      </div>
    </Card>
  );
}
