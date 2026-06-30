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
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
