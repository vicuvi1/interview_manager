"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f0f13] px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ef4444]/10 text-[#f87171]">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold text-[#f0f0f5]">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-white/45">
        An unexpected error occurred. You can try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
