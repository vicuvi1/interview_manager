import * as React from "react";

import { cn } from "@/lib/utils";

const base =
  "w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm " +
  "placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 " +
  "focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:bg-slate-50";

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
