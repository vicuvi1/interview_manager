import * as React from "react";

import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-white/10 bg-[#1a1a24] text-[13px] text-[#f0f0f5] " +
  "placeholder:text-white/25 transition-colors focus:border-[#6366f1] focus:outline-none " +
  "focus:ring-2 focus:ring-[#6366f1]/25 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, "h-10 px-3", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, "min-h-[88px] px-3 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";
