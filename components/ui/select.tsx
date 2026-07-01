import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-10 w-full appearance-none rounded-lg border border-white/10 bg-[#1a1a24] px-3 pr-9 text-[13px]",
        "text-[#f0f0f5] transition-colors focus:border-[#6366f1] focus:outline-none focus:ring-2",
        "focus:ring-[#6366f1]/25 disabled:cursor-not-allowed disabled:opacity-60 [&>option]:bg-[#1a1a24]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
  </div>
));
Select.displayName = "Select";
