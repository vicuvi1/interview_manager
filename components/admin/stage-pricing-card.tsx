"use client";

import { useEffect, useState } from "react";
import { Loader2, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { INTERVIEW_TYPES } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import type { InterviewPricing } from "@/lib/types";

export function StagePricingCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("interview_pricing").select("*");
      const map: Record<string, string> = {};
      for (const row of (data as InterviewPricing[] | null) ?? []) {
        map[row.interview_type] = (row.price_cents / 100).toFixed(2);
      }
      setPrices(map);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const rows: InterviewPricing[] = [];
    const toDelete: string[] = [];
    for (const type of INTERVIEW_TYPES) {
      const raw = (prices[type] ?? "").trim();
      if (!raw) {
        toDelete.push(type);
        continue;
      }
      const cents = Math.round(parseFloat(raw) * 100);
      if (cents > 0) rows.push({ interview_type: type, price_cents: cents, currency: "USD" });
      else toDelete.push(type);
    }
    if (rows.length) {
      const { error } = await supabase.from("interview_pricing").upsert(rows, { onConflict: "interview_type" });
      if (error) {
        setBusy(false);
        return toast({ title: "Couldn't save prices", description: error.message, variant: "error" });
      }
    }
    if (toDelete.length) {
      await supabase.from("interview_pricing").delete().in("interview_type", toDelete);
    }
    setBusy(false);
    toast({ title: "Default prices saved", variant: "success" });
  }

  return (
    <SectionCard title="Default prices by stage" description="Auto-fills the invoice when you set an interview's stage." icon={Tag}>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {INTERVIEW_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-white/70">{type}</span>
                <span className="text-white/30">$</span>
                <Input
                  inputMode="decimal"
                  placeholder="—"
                  value={prices[type] ?? ""}
                  onChange={(e) => setPrices((p) => ({ ...p, [type]: e.target.value }))}
                  className="h-8 w-24"
                  aria-label={`Price for ${type}`}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-white/35">Leave a field blank for no default. Prices are in USD.</p>
          <Button size="sm" loading={busy} onClick={save}>
            Save prices
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
