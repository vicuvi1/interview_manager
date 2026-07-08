"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Receipt } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types";

/**
 * Full-screen "New invoice — please pay" popup for candidates. When an admin
 * sends an invoice it inserts a `type: "invoice"` notification; this listens for
 * that insert over Realtime and takes over the whole screen so it can't be
 * missed (the corner toast is deliberately suppressed for invoices). Fires once
 * per invoice sent while the candidate has the app open; it is not persisted
 * across reloads.
 */
export function InvoicePopup({ userId }: { userId: string }) {
  const [queue, setQueue] = useState<Notification[]>([]);
  // Don't fire for rows Realtime may replay right after we subscribe.
  const seeded = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`invoice-popup-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          if (n.type === "invoice" && seeded.current) setQueue((q) => [...q, n]);
        },
      )
      .subscribe();
    const t = window.setTimeout(() => {
      seeded.current = true;
    }, 1200);
    return () => {
      window.clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const current = queue[0];
  if (!current) return null;

  const dismiss = () => setQueue((q) => q.slice(1));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-popup-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#13131a] p-6 text-center shadow-2xl shadow-black/60">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f59e0b]/15">
          <Receipt className="h-7 w-7 text-[#fbbf24]" />
        </span>
        <h2 id="invoice-popup-title" className="text-lg font-semibold text-[#f0f0f5]">
          {current.title || "New invoice from admin"}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">
          {current.detail ?? "You have a new invoice. Please pay."}
        </p>
        {queue.length > 1 ? (
          <p className="mt-2 text-[11px] text-white/35">{queue.length - 1} more invoice{queue.length - 1 === 1 ? "" : "s"} after this</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/candidate/payments"
            onClick={dismiss}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#6366f1] px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#5457e5]"
          >
            <Receipt className="h-4 w-4" /> Go to Payments
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="text-[12px] text-white/40 transition-colors hover:text-white/70"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
