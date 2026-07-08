"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { InterviewRequest } from "@/lib/types";

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** "Frontend · Acme · Jul 2" — enough to recognise a past request at a glance. */
function optionLabel(r: InterviewRequest): string {
  const parts = [r.role || r.interview_type || "Interview"];
  if (r.company) parts.push(r.company);
  const d = shortDate(r.created_at);
  if (d) parts.push(d);
  return parts.join(" · ");
}

/**
 * Lets a returning candidate repeat a past interview request — pick one and the
 * form fills its details in, so they only choose a new time. Renders nothing
 * until we know the person has at least one prior request.
 */
export function BookAgainBar({
  userId,
  onApply,
}: {
  userId: string;
  onApply: (r: InterviewRequest) => void;
}) {
  const { toast } = useToast();
  const [past, setPast] = useState<InterviewRequest[] | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("interview_requests")
        .select("*")
        .eq("candidate_id", userId)
        .order("created_at", { ascending: false })
        .limit(8);
      setPast((data as InterviewRequest[] | null) ?? []);
    })();
  }, [userId]);

  if (!past || past.length === 0) return null;

  return (
    <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-white/45">
        <History className="h-3.5 w-3.5" />
        Book again
      </div>
      <p className="text-[12px] text-white/40">
        Repeat a past request — we&apos;ll fill the details in. Just pick a new time.
      </p>
      <Select
        value={value}
        aria-label="Repeat a past request"
        onChange={(e) => {
          const id = e.target.value;
          setValue(id);
          if (!id) return;
          const r = past.find((x) => x.id === id);
          if (r) {
            onApply(r);
            toast({ title: "Details filled in", description: "Review them and pick a new time.", variant: "success" });
          }
        }}
      >
        <option value="">Repeat a past request…</option>
        {past.map((r) => (
          <option key={r.id} value={r.id}>
            {optionLabel(r)}
          </option>
        ))}
      </Select>
    </div>
  );
}
