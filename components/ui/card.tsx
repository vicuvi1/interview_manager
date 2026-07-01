import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-white/[0.06] bg-[#13131a]", className)}
      {...props}
    />
  );
}

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: SectionCardProps) {
  return (
    <Card className={cn("animate-fade-in overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/50">
              <Icon className="h-[18px] w-[18px]" />
            </span>
          ) : null}
          <div>
            <h2 className="text-[13px] font-medium text-[#f0f0f5] sm:text-sm">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[12px] text-white/40">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
    </Card>
  );
}
