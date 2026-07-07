"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/report-error";

/** Captures uncaught client errors + unhandled promise rejections app-wide. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, { source: "window.onerror" });
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, { source: "unhandledrejection" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
