import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TG = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;
const ACTIVE = ["approved", "scheduled", "completed"];

// Always answer Telegram with 200 so it doesn't retry; failures are swallowed.
const ok = () => NextResponse.json({ ok: true });

function fmt(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  }
}

async function send(token: string, chatId: string, text: string) {
  try {
    await fetch(TG(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch {
    /* ignore */
  }
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret) return ok();

  const admin = createAdminClient();
  if (!admin) return ok();

  const { data: row } = await admin
    .from("telegram_settings")
    .select("user_id, bot_token, chat_id")
    .eq("webhook_secret", secret)
    .maybeSingle();
  const settings = row as { user_id: string; bot_token: string; chat_id: string | null } | null;
  if (!settings?.bot_token) return ok();

  const update = await request.json().catch(() => null);
  const msg = update?.message;
  const text: string | undefined = msg?.text;
  const chatId = msg?.chat?.id;
  if (!text || chatId == null) return ok();

  // Link / refresh the chat id automatically the first time they message the bot.
  if (String(chatId) !== settings.chat_id) {
    await admin.from("telegram_settings").update({ chat_id: String(chatId) }).eq("user_id", settings.user_id);
  }

  const { data: prof } = await admin
    .from("profiles")
    .select("role, timezone, full_name")
    .eq("id", settings.user_id)
    .maybeSingle();
  const profile = (prof as { role?: string; timezone?: string; full_name?: string } | null) ?? {};
  const tz = profile.timezone || "UTC";
  const isAdmin = profile.role === "admin";

  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  const origin = new URL(request.url).origin;

  let reply: string;

  if (cmd === "/start" || cmd === "/help") {
    reply =
      "👋 Interview Scheduler bot. You'll get your updates here.\n\n" +
      "Commands:\n" +
      "/next — your next interview\n" +
      "/interviews — upcoming interviews\n" +
      (isAdmin ? "" : "/pay — interviews you still owe for\n") +
      "/help — this message";
  } else if (cmd === "/next" || cmd === "/interviews" || cmd === "/upcoming") {
    let q = admin
      .from("interview_requests")
      .select("role, scheduled_at, meeting_link, candidate_id, status")
      .eq("status", "scheduled")
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(cmd === "/next" ? 1 : 5);
    if (!isAdmin) q = q.eq("candidate_id", settings.user_id);
    const { data } = await q;
    const rows = (data as { role: string; scheduled_at: string; meeting_link: string | null; candidate_id: string }[] | null) ?? [];

    // Resolve candidate names for the admin view.
    let names: Record<string, string> = {};
    if (isAdmin && rows.length) {
      const ids = Array.from(new Set(rows.map((r) => r.candidate_id)));
      const { data: ps } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
      names = Object.fromEntries(((ps as { id: string; full_name: string | null; email: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name || p.email || "Candidate"]));
    }

    if (!rows.length) {
      reply = "No upcoming interviews.";
    } else {
      reply = (cmd === "/next" ? "⏭️ Next interview:\n" : "📅 Upcoming interviews:\n") +
        rows
          .map((r) => {
            const who = isAdmin ? `${names[r.candidate_id] ?? "Candidate"} · ` : "";
            return `• ${who}${r.role} — ${fmt(r.scheduled_at, tz)}${r.meeting_link ? `\n  ${r.meeting_link}` : ""}`;
          })
          .join("\n");
    }
  } else if (cmd === "/pay" && !isAdmin) {
    const { data } = await admin
      .from("interview_requests")
      .select("role, price_cents, currency, payment_status, status")
      .eq("candidate_id", settings.user_id)
      .neq("payment_status", "paid")
      .in("status", ACTIVE);
    const rows = (data as { role: string; price_cents: number | null; currency: string }[] | null) ?? [];
    if (!rows.length) {
      reply = "✅ You're all settled — no payments due.";
    } else {
      reply =
        "💳 Payments due:\n" +
        rows
          .map((r) => `• ${r.role}${r.price_cents ? ` — $${(r.price_cents / 100).toFixed(2)}` : ""}`)
          .join("\n") +
        `\n\nPay here: ${origin}/candidate/payments`;
    }
  } else {
    reply = "Unknown command. Try /help.";
  }

  await send(settings.bot_token, String(chatId), reply);
  return ok();
}
