"use client";

import { useEffect, useState } from "react";
import { ListChecks, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { type FieldConfig, type FieldLevel, fieldLevel, REQUEST_FIELDS } from "@/lib/request-fields";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LEVELS: { value: FieldLevel; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
  { value: "hidden", label: "Hidden" },
];

export function RequestFieldsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<FieldConfig>({});

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("app_settings").select("request_fields").eq("id", 1).maybeSingle();
      const raw = (data as { request_fields?: FieldConfig } | null)?.request_fields ?? {};
      // Materialize effective levels so the controls reflect the defaults too.
      const eff: FieldConfig = {};
      for (const f of REQUEST_FIELDS) eff[f.key] = fieldLevel(raw, f.key);
      setCfg(eff);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({ request_fields: cfg, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    toast({ title: "Form fields saved", variant: "success" });
  }

  return (
    <SectionCard
      title="Request form fields"
      description="Decide what candidates must fill in. Hidden fields don't appear at all."
      icon={ListChecks}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2.5">
          {REQUEST_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/75">{f.label}</span>
              <div className="flex rounded-lg border border-white/10 bg-[#0f0f13] p-0.5">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setCfg((c) => ({ ...c, [f.key]: l.value }))}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                      cfg[f.key] === l.value
                        ? l.value === "required"
                          ? "bg-[#6366f1]/[0.2] text-[#c7d2fe]"
                          : l.value === "hidden"
                            ? "bg-white/[0.08] text-white/70"
                            : "bg-white/[0.06] text-white/70"
                        : "text-white/40 hover:text-white/70",
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-white/35">
            The résumé/CV is the usual must-have. Levels apply the next time a candidate opens the form.
          </p>
          <Button size="sm" loading={busy} onClick={save}>
            Save fields
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
