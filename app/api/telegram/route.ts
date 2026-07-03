import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TG = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

// Any signed-in user may connect their own Telegram (each owns their own row).
async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { supabase, userId: user.id };
}

/** Ask Telegram for recent updates and pull the most recent chat id. */
async function detectChatId(token: string): Promise<string | null> {
  try {
    const res = await fetch(TG(token, "getUpdates"), { cache: "no-store" });
    const json = await res.json();
    if (!json.ok || !Array.isArray(json.result)) return null;
    for (let i = json.result.length - 1; i >= 0; i--) {
      const u = json.result[i];
      const chat = u?.message?.chat ?? u?.my_chat_member?.chat ?? u?.channel_post?.chat;
      if (chat?.id != null) return String(chat.id);
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return ctx.error;

  const { data } = await ctx.supabase
    .from("telegram_settings")
    .select("bot_username, chat_id, reminder_minutes, enabled, webhook_secret")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const row = data as
    | {
        bot_username: string | null;
        chat_id: string | null;
        reminder_minutes: number;
        enabled: boolean;
        webhook_secret: string | null;
      }
    | null;

  return NextResponse.json({
    hasToken: !!row,
    botUsername: row?.bot_username ?? null,
    connected: !!row?.chat_id,
    reminderMinutes: row?.reminder_minutes ?? 15,
    enabled: row?.enabled ?? true,
    commandsEnabled: !!row?.webhook_secret,
  });
}

export async function POST(request: Request) {
  const ctx = await requireUser();
  if ("error" in ctx) return ctx.error;
  const { supabase, userId } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = body?.action as string;

  if (action === "connect") {
    const token = String(body?.token ?? "").trim();
    if (!token) return NextResponse.json({ error: "Paste your bot token." }, { status: 400 });

    // Validate the token.
    let botUsername: string | null = null;
    try {
      const res = await fetch(TG(token, "getMe"), { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) return NextResponse.json({ error: "That bot token isn't valid." }, { status: 400 });
      botUsername = json.result?.username ?? null;
    } catch {
      return NextResponse.json({ error: "Couldn't reach Telegram. Try again." }, { status: 502 });
    }

    const chatId = await detectChatId(token);
    const { error } = await supabase.from("telegram_settings").upsert(
      {
        user_id: userId,
        bot_token: token,
        bot_username: botUsername,
        chat_id: chatId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, botUsername, connected: !!chatId });
  }

  if (action === "refresh") {
    const { data } = await supabase.from("telegram_settings").select("bot_token").eq("user_id", userId).maybeSingle();
    const token = (data as { bot_token?: string } | null)?.bot_token;
    if (!token) return NextResponse.json({ error: "Connect a bot first." }, { status: 400 });
    const chatId = await detectChatId(token);
    if (!chatId) {
      return NextResponse.json({ ok: false, connected: false, hint: "Send /start to your bot in Telegram, then try again." });
    }
    await supabase.from("telegram_settings").update({ chat_id: chatId, updated_at: new Date().toISOString() }).eq("user_id", userId);
    return NextResponse.json({ ok: true, connected: true });
  }

  if (action === "update") {
    const update: Record<string, unknown> = {
      enabled: body?.enabled !== false,
      updated_at: new Date().toISOString(),
    };
    // Only admins send reminderMinutes; don't clobber it for candidates.
    if (body?.reminderMinutes !== undefined && body?.reminderMinutes !== null) {
      update.reminder_minutes = Math.max(1, Math.min(240, Number(body.reminderMinutes) || 15));
    }
    const { error } = await supabase.from("telegram_settings").update(update).eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "test") {
    const { data } = await supabase
      .from("telegram_settings")
      .select("bot_token, chat_id")
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as { bot_token?: string; chat_id?: string } | null;
    if (!row?.bot_token || !row?.chat_id) {
      return NextResponse.json({ error: "Connect your bot and detect the chat first." }, { status: 400 });
    }
    try {
      const res = await fetch(TG(row.bot_token, "sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          chat_id: row.chat_id,
          text: "✅ Interview Scheduler is connected. You'll get your updates here.",
        }),
      });
      const json = await res.json();
      if (!json.ok) return NextResponse.json({ error: json.description ?? "Telegram rejected the message." }, { status: 400 });
    } catch {
      return NextResponse.json({ error: "Couldn't reach Telegram." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "diagnose") {
    const { data, error } = await supabase.rpc("telegram_diagnostics");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, diagnostics: data });
  }

  if (action === "enable-commands") {
    const { data } = await supabase.from("telegram_settings").select("bot_token").eq("user_id", userId).maybeSingle();
    const token = (data as { bot_token?: string } | null)?.bot_token;
    if (!token) return NextResponse.json({ error: "Connect a bot first." }, { status: 400 });

    const secret = crypto.randomUUID().replace(/-/g, "");
    const webhookUrl = `${new URL(request.url).origin}/api/telegram/webhook`;
    try {
      const res = await fetch(TG(token, "setWebhook"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ["message"] }),
      });
      const json = await res.json();
      if (!json.ok) return NextResponse.json({ error: json.description ?? "Telegram rejected the webhook." }, { status: 400 });
    } catch {
      return NextResponse.json({ error: "Couldn't reach Telegram." }, { status: 502 });
    }
    const { error } = await supabase
      .from("telegram_settings")
      .update({ webhook_secret: secret, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, commandsEnabled: true });
  }

  if (action === "disable-commands") {
    const { data } = await supabase.from("telegram_settings").select("bot_token").eq("user_id", userId).maybeSingle();
    const token = (data as { bot_token?: string } | null)?.bot_token;
    if (token) {
      try {
        await fetch(TG(token, "deleteWebhook"), { method: "POST", cache: "no-store" });
      } catch {
        /* ignore — clear the secret regardless */
      }
    }
    await supabase
      .from("telegram_settings")
      .update({ webhook_secret: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    return NextResponse.json({ ok: true, commandsEnabled: false });
  }

  if (action === "disconnect") {
    // Best-effort: drop any webhook we set so the old bot stops calling us.
    const { data } = await supabase.from("telegram_settings").select("bot_token").eq("user_id", userId).maybeSingle();
    const token = (data as { bot_token?: string } | null)?.bot_token;
    if (token) {
      try {
        await fetch(TG(token, "deleteWebhook"), { method: "POST", cache: "no-store" });
      } catch {
        /* ignore */
      }
    }
    const { error } = await supabase.from("telegram_settings").delete().eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
