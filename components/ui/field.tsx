import * as React from "react";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-white/55">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-[#f87171]">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-white/30">{hint}</p>
      ) : null}
    </div>
  );
}
