import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Receives client error reports and logs them (visible in Vercel logs). If
 * ERROR_WEBHOOK_URL is set, also forwards a short line to that webhook
 * (Slack/Telegram/etc.). No external dependencies.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore malformed body */
  }

  const stack = typeof body.stack === "string" ? body.stack.split("\n").slice(0, 6).join("\n") : undefined;
  console.error(
    "[client-error]",
    JSON.stringify({
      message: body.message,
      source: body.source,
      url: body.url,
      digest: body.digest,
      stack,
      ua: req.headers.get("user-agent"),
      at: new Date().toISOString(),
    }),
  );

  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `⚠️ Client error: ${String(body.message)}\n${String(body.url ?? "")} · ${String(body.source ?? "")}` }),
      });
    } catch {
      /* best-effort */
    }
  }

  return new Response(null, { status: 204 });
}
