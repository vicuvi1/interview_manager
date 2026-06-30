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
        "h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-9 text-sm",
        "text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2",
        "focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:bg-slate-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
  </div>
));
Select.displayName = "Select";
