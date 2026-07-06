"use client";

import { useEffect, useState } from "react";
import { Loader2, Palette, Plus } from "lucide-react";

import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { allTypeKeys, DEFAULT_TYPE_STYLE, type DurationMap, defaultDurationFor, type TypeStyleMap, typeStyle } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";

export function InterviewTypeStylesCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [styles, setStyles] = useState<TypeStyleMap>({});
  const [durations, setDurations] = useState<DurationMap>({});
  const [newType, setNewType] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("app_settings")
        .select("interview_type_styles, type_durations")
        .eq("id", 1)
        .maybeSingle();
      const overrides = (data as { interview_type_styles?: TypeStyleMap } | null)?.interview_type_styles ?? {};
      const durs = (data as { type_durations?: DurationMap } | null)?.type_durations ?? {};
      // Materialize an entry for every known + custom type so the controls show defaults too.
      const eff: TypeStyleMap = {};
      const effDur: DurationMap = {};
      for (const key of allTypeKeys(overrides)) {
        eff[key] = typeStyle(key, overrides);
        effDur[key] = defaultDurationFor(key, durs);
      }
      setStyles(eff);
      setDurations(effDur);
      setLoading(false);
    })();
  }, []);

  function setEmoji(type: string, emoji: string) {
    setStyles((s) => ({ ...s, [type]: { ...s[type], emoji } }));
  }
  function setColor(type: string, color: string) {
    setStyles((s) => ({ ...s, [type]: { ...s[type], color } }));
  }
  function setDur(type: string, minutes: number) {
    setDurations((d) => ({ ...d, [type]: Math.max(1, Math.min(1440, Math.round(minutes) || 30)) }));
  }
  function addType() {
    const name = newType.trim();
    if (!name) return;
    if (styles[name]) return toast({ title: "That type already exists", variant: "info" });
    setStyles((s) => ({ ...s, [name]: { ...DEFAULT_TYPE_STYLE } }));
    setDurations((d) => ({ ...d, [name]: 30 }));
    setNewType("");
  }

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .update({ interview_type_styles: styles, type_durations: durations, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    toast({ title: "Interview types saved", variant: "success" });
  }

  return (
    <SectionCard
      title="Interview types — emoji, color & default length"
      description="Give each type an emoji, color, and default duration. Shown on the calendar and pre-filled when that type is booked."
      icon={Palette}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {Object.keys(styles).map((type) => (
            <div key={type} className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.05] pb-2.5">
              <input
                value={styles[type].emoji}
                onChange={(e) => setEmoji(type, e.target.value)}
                maxLength={4}
                aria-label={`Emoji for ${type}`}
                className="h-9 w-11 shrink-0 rounded-lg border border-white/10 bg-[#0f0f13] text-center text-[16px] outline-none focus:border-white/25"
              />
              <span
                className="inline-block h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: styles[type].color }}
                aria-hidden
              />
              <span className="min-w-[110px] flex-1 text-[13px] text-white/75">{type}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={durations[type] ?? 30}
                  onChange={(e) => setDur(type, Number(e.target.value))}
                  aria-label={`Default minutes for ${type}`}
                  className="h-9 w-16 rounded-lg border border-white/10 bg-[#0f0f13] px-2 text-center text-[13px] tabular-nums outline-none focus:border-white/25"
                />
                <span className="text-[12px] text-white/40">min</span>
              </div>
              <ColorPicker value={styles[type].color} onChange={(v) => setColor(type, v ?? DEFAULT_TYPE_STYLE.color)} />
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="min-w-[180px] flex-1">
              <Input
                placeholder="Add a custom type… (e.g. Culture fit)"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addType();
                  }
                }}
              />
            </div>
            <Button type="button" variant="secondary" size="sm" disabled={!newType.trim()} onClick={addType}>
              <Plus className="h-4 w-4" /> Add type
            </Button>
          </div>

          <p className="text-[11px] text-white/35">Tip: paste any emoji into the box. Changes apply once you save.</p>
          <Button size="sm" loading={busy} onClick={save}>
            Save styles
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
