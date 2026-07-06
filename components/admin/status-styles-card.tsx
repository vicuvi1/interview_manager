"use client";

import { useEffect, useState } from "react";
import { Loader2, Tags } from "lucide-react";

import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  ALL_STATUSES,
  DEFAULT_STATUS_COLORS,
  type StatusColorMap,
  type StatusLabelMap,
  statusColor,
  statusLabel,
} from "@/lib/status";
import { createClient } from "@/lib/supabase/client";
import { invalidateStatusSettings } from "@/lib/use-status-settings";

export function StatusStylesCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<StatusLabelMap>({});
  const [colors, setColors] = useState<StatusColorMap>({});

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("app_settings").select("status_labels, status_colors").eq("id", 1).maybeSingle();
      const lbl = (data as { status_labels?: StatusLabelMap } | null)?.status_labels ?? {};
      const col = (data as { status_colors?: StatusColorMap } | null)?.status_colors ?? {};
      // Materialize an entry per status so every control shows its current value.
      const effL: StatusLabelMap = {};
      const effC: StatusColorMap = {};
      for (const s of ALL_STATUSES) {
        effL[s] = statusLabel(s, lbl);
        effC[s] = statusColor(s, col);
      }
      setLabels(effL);
      setColors(effC);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({ status_labels: labels, status_colors: colors, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    invalidateStatusSettings();
    toast({ title: "Status styles saved", variant: "success" });
  }

  return (
    <SectionCard
      title="Statuses — labels & colors"
      description="Rename and recolor each interview status. Shown on badges everywhere and the calendar legend."
      icon={Tags}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {ALL_STATUSES.map((s) => (
            <div key={s} className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.05] pb-2.5">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: colors[s] }}
                aria-hidden
              />
              <span className="w-24 shrink-0 text-[12px] capitalize text-white/45">{s}</span>
              <div className="min-w-[150px] flex-1">
                <Input
                  value={labels[s] ?? ""}
                  onChange={(e) => setLabels((m) => ({ ...m, [s]: e.target.value }))}
                  placeholder={s}
                  aria-label={`Label for ${s}`}
                />
              </div>
              <ColorPicker value={colors[s]} onChange={(v) => setColors((m) => ({ ...m, [s]: v ?? DEFAULT_STATUS_COLORS[s] }))} />
            </div>
          ))}
          <p className="text-[11px] text-white/35">Leave a label blank to use the default. Changes apply once you save.</p>
          <Button size="sm" loading={busy} onClick={save}>
            Save statuses
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
