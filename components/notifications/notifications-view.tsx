"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { notifMeta, notifTypeLabel } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/types";

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Earlier this week";
  if (diffDays < 30) return "This month";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "This month", "Older"];

export function NotificationsView({ initial, userId }: { initial: Notification[]; userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Notification[]>(initial);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false });
    if (data) setItems(data as Notification[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notif-page-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);
  const types = useMemo(() => Array.from(new Set(items.map((n) => n.type))), [items]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => !n.read);
    return items.filter((n) => n.type === filter);
  }, [items, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of filtered) {
      const b = dayBucket(n.created_at);
      const arr = map.get(b) ?? [];
      arr.push(n);
      map.set(b, arr);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, rows: map.get(b)! }));
  }, [filtered]);

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("read", false);
  }

  async function markRead(n: Notification) {
    if (n.read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("id", n.id);
  }

  async function remove(n: Notification) {
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    const supabase = createClient();
    const { error } = await supabase.from("notifications").delete().eq("id", n.id);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "error" });
      load();
    }
  }

  async function clearAll() {
    const ids = items.map((n) => n.id);
    if (ids.length === 0) return;
    setItems([]);
    const supabase = createClient();
    const { error } = await supabase.from("notifications").delete().in("id", ids);
    if (error) {
      toast({ title: "Couldn't clear", description: error.message, variant: "error" });
      load();
    } else {
      toast({ title: "Notifications cleared", variant: "success" });
    }
  }

  const FILTERS = [
    { value: "all", label: "All" },
    { value: "unread", label: `Unread${unreadCount ? ` (${unreadCount})` : ""}` },
    ...types.map((t) => ({ value: t, label: notifTypeLabel(t) })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Notifications</h1>
          <p className="text-[12px] text-white/40">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 ? (
            <Button size="sm" variant="secondary" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4" /> Mark all read
            </Button>
          ) : null}
          {items.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              <Trash2 className="h-4 w-4" /> Clear all
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              filter === f.value
                ? "bg-[#6366f1]/[0.16] text-[#c7d2fe] ring-1 ring-inset ring-[#6366f1]/30"
                : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <SectionCard title="Inbox" description={`${filtered.length} notification${filtered.length === 1 ? "" : "s"}`} icon={Bell} bodyClassName="p-0 sm:p-0">
        {filtered.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Bell} title="Nothing here" description="No notifications match this filter." />
          </div>
        ) : (
          <div>
            {groups.map((g) => (
              <div key={g.bucket}>
                <p className="border-b border-white/[0.06] bg-white/[0.015] px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/35 sm:px-6">
                  {g.bucket}
                </p>
                <ul className="divide-y divide-white/[0.05]">
                  {g.rows.map((n) => {
                    const meta = notifMeta(n.type);
                    const Icon = meta.icon;
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03] sm:px-6",
                          !n.read && "bg-[#8b5cf6]/[0.04]",
                        )}
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04]">
                          <Icon className={cn("h-4 w-4", meta.iconClass)} />
                        </span>
                        <button type="button" onClick={() => markRead(n)} className="min-w-0 flex-1 text-left">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-[#f0f0f5]">{n.title}</span>
                            {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8b5cf6]" /> : null}
                          </span>
                          {n.detail ? <span className="mt-0.5 block text-[12px] text-white/55">{n.detail}</span> : null}
                          <span className="mt-1 block text-[11px] text-white/30">{relativeTime(n.created_at)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(n)}
                          className="mt-0.5 shrink-0 rounded-md p-1 text-white/25 opacity-0 transition hover:bg-white/[0.06] hover:text-[#f87171] group-hover:opacity-100"
                          aria-label="Delete notification"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
