"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { notifMeta } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/types";

export function NotificationBell({ userId, notifHref }: { userId: string; notifHref: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false),
    ]);
    if (data) setItems(data as Notification[]);
    setUnread(count ?? 0);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bell-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "INSERT" && seeded.current) {
            const n = payload.new as Notification;
            // Invoices get a full-screen popup instead of a corner toast.
            if (n.type !== "invoice") toast({ title: n.title, description: n.detail ?? undefined, variant: "info" });
          }
          refresh();
        },
      )
      .subscribe();
    // avoid a toast storm for rows that arrive right after mount
    const t = window.setTimeout(() => {
      seeded.current = true;
    }, 1500);
    // Safety net: refetch every 30s so notifications still surface even if a
    // project's Realtime isn't delivering (no more "only after I refresh").
    const poll = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [userId, refresh, toast]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
    refresh();
  }

  async function markRead(n: Notification) {
    if (n.read) return;
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#8b5cf6] px-1 text-[9px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#13131a] shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="text-[13px] font-medium text-[#f0f0f5]">
              Notifications{unread > 0 ? <span className="ml-1.5 text-white/40">· {unread} new</span> : null}
            </p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[12px] text-[#a5b4fc] hover:text-[#c7d2fe]"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] text-white/35">{"You're all caught up."}</p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {items.map((n) => {
                  const meta = notifMeta(n.type);
                  const Icon = meta.icon;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => markRead(n)}
                        className={cn(
                          "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]",
                          !n.read && "bg-[#8b5cf6]/[0.05]",
                        )}
                      >
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                          <Icon className={cn("h-3.5 w-3.5", meta.iconClass)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-[#f0f0f5]">{n.title}</span>
                            {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8b5cf6]" /> : null}
                          </span>
                          {n.detail ? <span className="mt-0.5 block truncate text-[12px] text-white/50">{n.detail}</span> : null}
                          <span className="mt-0.5 block text-[11px] text-white/30">{relativeTime(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link
            href={notifHref}
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 border-t border-white/[0.06] px-4 py-2.5 text-[12px] font-medium text-white/60 hover:bg-white/[0.03] hover:text-white/90"
          >
            <Check className="h-3.5 w-3.5" /> View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}
