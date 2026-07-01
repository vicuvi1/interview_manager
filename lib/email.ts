/** Minimal Resend sender (server-only). No SDK — just the HTTP API. */
export async function sendEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ from: opts.from, to: opts.to, subject: opts.subject, html: opts.html }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.message || json?.name || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
