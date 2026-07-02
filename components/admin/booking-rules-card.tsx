"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

export function BookingRulesCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [minNotice, setMinNotice] = useState("0");
  const [buffer, setBuffer] = useState("0");
  const [horizon, setHorizon] = useState("0");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("min_notice_hours, buffer_minutes, booking_horizon_days")
        .eq("id", 1)
        .maybeSingle();
      if (data) {
        setMinNotice(String(data.min_notice_hours ?? 0));
        setBuffer(String(data.buffer_minutes ?? 0));
        setHorizon(String(data.booking_horizon_days ?? 0));
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({
        min_notice_hours: Math.max(0, Math.round(Number(minNotice) || 0)),
        buffer_minutes: Math.max(0, Math.round(Number(buffer) || 0)),
        booking_horizon_days: Math.max(0, Math.round(Number(horizon) || 0)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast({ title: "Couldn't save rules", description: error.message, variant: "error" });
    toast({ title: "Booking rules saved", variant: "success" });
  }

  return (
    <SectionCard
      title="Booking rules"
      description="Optional guardrails for candidate bookings. Leave at 0 for no restriction."
      icon={ShieldCheck}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Minimum notice (hours)" htmlFor="br-notice" hint="0 = anytime">
              <Input id="br-notice" type="number" min={0} value={minNotice} onChange={(e) => setMinNotice(e.target.value)} />
            </Field>
            <Field label="Buffer between (min)" htmlFor="br-buffer" hint="0 = none">
              <Input id="br-buffer" type="number" min={0} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            </Field>
            <Field label="Book up to (days ahead)" htmlFor="br-horizon" hint="0 = unlimited">
              <Input id="br-horizon" type="number" min={0} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
            </Field>
          </div>
          <p className="text-[11px] text-white/35">
            Minimum notice blocks last-minute requests; buffer warns you about back-to-back interviews; the horizon caps
            how far ahead candidates can book. All default to no limit.
          </p>
          <Button size="sm" loading={busy} onClick={save}>
            Save rules
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
