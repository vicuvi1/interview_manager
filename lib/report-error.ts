/**
 * Lightweight, dependency-free client error reporter. Fire-and-forget POST to
 * /api/client-error, which logs to the server (visible in Vercel logs) and can
 * forward to a webhook. Swap the fetch for Sentry.captureException later if you
 * add the SDK — call sites don't need to change.
 */
export interface ErrorReport {
  message: string;
  stack?: string;
  source?: string;
  url?: string;
  digest?: string;
}

export function reportClientError(err: unknown, ctx?: { source?: string; digest?: string }): void {
  try {
    const e = err as { message?: unknown; stack?: unknown; digest?: unknown } | null;
    const body: ErrorReport = {
      message: e && e.message != null ? String(e.message) : String(err),
      stack: typeof e?.stack === "string" ? e.stack : undefined,
      source: ctx?.source,
      digest: ctx?.digest ?? (typeof e?.digest === "string" ? e.digest : undefined),
      url: typeof window !== "undefined" ? window.location.href : undefined,
    };
    // keepalive so it still sends during a navigation/unload.
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let reporting throw */
  }
}
