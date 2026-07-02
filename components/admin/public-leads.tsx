"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Mailbox, UserPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, relativeTime } from "@/lib/time";

interface Lead {
  id: string;
  name: string;
  email: string;
  role: string;
  preferred_at: string | null;
  timezone: string | null;
  notes: string | null;
  created_at: string;
}

export function PublicLeads() {
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("public_booking_requests")
      .select("*")
      .eq("status", "new")
      .order("created_at", { ascending: false });
    if (data) setLeads(data as Lead[]);
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("public-leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "public_booking_requests" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function dismiss(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("public_booking_requests").update({ status: "dismissed" }).eq("id", id);
    if (error) return toast({ title: "Couldn't dismiss", description: error.message, variant: "error" });
    load();
  }

  async function convert(id: string) {
    setBusyId(id);
    const res = await fetch("/api/admin/convert-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: id }),
    });
    const r = await res.json();
    setBusyId(null);
    if (r.error) return toast({ title: "Couldn't convert", description: r.error, variant: "error" });
    toast({ title: "Converted to an interview request", variant: "success" });
    if (r.password) setCreds({ email: r.email, password: r.password });
    load();
  }

  return (
    <>
      <SectionCard
        title="Incoming requests"
        description="People who used your public booking link."
        icon={Mailbox}
        bodyClassName="p-0 sm:p-0"
      >
        {leads.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Inbox} title="No new requests" description="Public booking requests will appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {leads.map((l) => (
              <li key={l.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-[14px] font-medium text-[#f0f0f5]">
                      {l.name}
                      <span className="truncate text-[12px] font-normal text-white/45">· {l.email}</span>
                      <CopyButton value={l.email} title="Copy email" className="h-6 w-6" />
                    </p>
                    <p className="text-[13px] text-white/70">{l.role}</p>
                    <p className="text-[12px] text-white/40">
                      {l.preferred_at ? `Prefers ${formatInTimeZone(l.preferred_at, l.timezone ?? "UTC")} · ` : ""}
                      {relativeTime(l.created_at)}
                    </p>
                    {l.notes ? <p className="mt-1 text-[12px] text-white/55">{l.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" loading={busyId === l.id} disabled={busyId !== null} onClick={() => convert(l.id)}>
                      <UserPlus className="h-4 w-4" /> Convert
                    </Button>
                    <button
                      type="button"
                      onClick={() => dismiss(l.id)}
                      className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-[#f87171]"
                      aria-label="Dismiss"
                      title="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {creds ? (
        <Dialog open onClose={() => setCreds(null)} title="Account created" description="Share these so they can sign in — shown once.">
          <div className="space-y-3 text-[13px]">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Email</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-white/85">{creds.email}</code>
                <CopyButton value={creds.email} title="Copy email" />
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Temporary password</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-white/85">{creds.password}</code>
                <CopyButton value={creds.password} title="Copy password" />
              </div>
            </div>
            <p className="rounded-lg bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[#fbbf24] ring-1 ring-inset ring-[#f59e0b]/25">
              Save this now — it won&apos;t be shown again. Ask them to change it after signing in.
            </p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
