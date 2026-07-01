"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import type { Notification } from "@/lib/types";

function variantFor(type: string): "success" | "error" | "info" {
  if (type === "rejected") return "error";
  if (type === "success" || type === "approved") return "success";
  return "info";
}

function iconFor(type: string): LucideIcon {
  switch (type) {
    case "approved":
      return CalendarCheck;
    case "rejected":
      return XCircle;
    case "success":
      return CheckCircle2;
    case "alert":
      return BellRing;
    default:
      return Info;
  }
}

export function NotificationsCard({
  userId,
  initial,
}: {
  userId: string;
  initial: Notification[];
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<Notification[]>(initial);
  const seenRef = useRef<Set<string>>(new Set(initial.map((n) => n.id)));

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!data) return;
    const rows = data as Notification[];
    for (const n of rows) {
      if (!seenRef.current.has(n.id)) {
        seenRef.current.add(n.id);
        toast({
          title: n.title,
          description: n.detail ?? undefined,
          variant: variantFor(n.type),
        });
      }
    }
    setItems(rows);
  }, [userId, toast]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unreadCount = items.filter((n) => !n.read).length;

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  async function markAllRead() {
    const unread = items.filter((n) => !n.read).map((n) => n.id);
    if (unread.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    const supabase = createClient();
    await supabase.from("notifications").update({ read: true }).in("id", unread);
  }

  return (
    <SectionCard
      title="Notifications"
      description="Live updates on your requests."
      icon={Bell}
      bodyClassName="p-0 sm:p-0"
      action={
        unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllRead}
            className="text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
          >
            Mark all read
          </button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="p-5 sm:p-6">
          <EmptyState
            icon={Bell}
            title="You're all caught up"
            description="New notifications appear here in real time."
          />
        </div>
      ) : (
        <ul className="max-h-[360px] divide-y divide-white/[0.06] overflow-y-auto scrollbar-thin">
          {items.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <li
                key={n.id}
                onClick={() => (n.read ? undefined : markRead(n.id))}
                onKeyDown={(e) => {
                  if (!n.read && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    markRead(n.id);
                  }
                }}
                role={n.read ? undefined : "button"}
                tabIndex={n.read ? undefined : 0}
                aria-label={n.read ? undefined : `Mark "${n.title}" as read`}
                className={`flex gap-3 px-5 py-3.5 sm:px-6 ${
                  n.read ? "" : "cursor-pointer hover:bg-white/[0.03]"
                }`}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/55">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[#f0f0f5]">{n.title}</p>
                    <span className="shrink-0 text-[12px] text-white/40">
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                  {n.detail ? (
                    <p className="mt-0.5 text-[13px] text-white/55">{n.detail}</p>
                  ) : null}
                </div>
                {!n.read ? (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#6366f1]" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
