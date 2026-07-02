"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, CheckCircle2, Inbox, Lightbulb, MessageSquare, RotateCcw } from "lucide-react";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

interface Feedback {
  id: string;
  name: string | null;
  email: string | null;
  category: "bug" | "idea" | "other";
  message: string;
  status: "new" | "resolved";
  created_at: string;
}

const CAT: Record<string, { label: string; tone: Tone; icon: typeof Bug }> = {
  bug: { label: "Bug", tone: "red", icon: Bug },
  idea: { label: "Idea", tone: "indigo", icon: Lightbulb },
  other: { label: "Feedback", tone: "slate", icon: MessageSquare },
};

export function FeedbackInbox({ initial }: { initial: Feedback[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Feedback[]>(initial);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("app_feedback").select("*").order("created_at", { ascending: false });
    if (data) setRows(data as Feedback[]);
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("admin-feedback")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_feedback" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function setStatus(id: string, status: "new" | "resolved") {
    const supabase = createClient();
    const { error } = await supabase.from("app_feedback").update({ status }).eq("id", id);
    if (error) return toast({ title: "Couldn't update", description: error.message, variant: "error" });
    load();
  }

  const visible = rows.filter((r) => (showResolved ? true : r.status === "new"));
  const newCount = rows.filter((r) => r.status === "new").length;
  const resolvedCount = rows.length - newCount;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-[#f0f0f5]">Feedback</h1>
          <p className="text-[12px] text-white/40">Bug reports and ideas from candidates.</p>
        </div>
        {resolvedCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-[12px] font-medium text-white/50 transition-colors hover:text-white/80"
          >
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
          </button>
        ) : null}
      </div>

      <SectionCard title={`Inbox${newCount ? ` · ${newCount} new` : ""}`} icon={Inbox} bodyClassName="p-0 sm:p-0">
        {visible.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState icon={Inbox} title="No feedback yet" description="Candidate bug reports and ideas will show up here." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {visible.map((f) => {
              const c = CAT[f.category] ?? CAT.other;
              const Icon = c.icon;
              return (
                <li key={f.id} className={cn("px-5 py-4 sm:px-6", f.status === "resolved" && "opacity-55")}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-white/60">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={c.tone}>{c.label}</Badge>
                        <span className="text-[13px] font-medium text-[#f0f0f5]">{f.name || "A candidate"}</span>
                        {f.email ? (
                          <span className="inline-flex items-center gap-0.5 text-[12px] text-white/40">
                            {f.email}
                            <CopyButton value={f.email} title="Copy email" className="h-5 w-5" />
                          </span>
                        ) : null}
                        <span className="text-[11px] text-white/30">· {relativeTime(f.created_at)}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">{f.message}</p>
                    </div>
                    <div className="shrink-0">
                      {f.status === "new" ? (
                        <Button size="sm" variant="secondary" onClick={() => setStatus(f.id, "resolved")}>
                          <CheckCircle2 className="h-4 w-4" /> Resolve
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, "new")}>
                          <RotateCcw className="h-4 w-4" /> Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
