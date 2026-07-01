"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { FORMATS, FORMAT_LABEL, INTERVIEW_TYPES, LEVELS } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import type { InterviewTemplate } from "@/lib/types";

export function TemplatesCard() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<InterviewTemplate[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [type, setType] = useState(INTERVIEW_TYPES[0]);
  const [level, setLevel] = useState("Not sure");
  const [duration, setDuration] = useState(30);
  const [format, setFormat] = useState("video");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("interview_templates").select("*").order("created_at", { ascending: false });
    if (data) setTemplates(data as InterviewTemplate[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!name.trim()) return toast({ title: "Name your template", variant: "error" });
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("interview_templates").insert({
      name: name.trim(),
      role: role.trim() || null,
      interview_type: type,
      level,
      duration_minutes: duration,
      format,
    });
    setBusy(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    setName("");
    setRole("");
    setAdding(false);
    toast({ title: "Template saved", variant: "success" });
    load();
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("interview_templates").delete().eq("id", id);
    if (error) return toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    load();
  }

  return (
    <SectionCard
      title="Interview templates"
      description="Presets to speed up manual bookings."
      icon={LayoutTemplate}
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          <Plus className="h-4 w-4" /> New
        </Button>
      }
    >
      {adding ? (
        <div className="mb-4 space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Template name" htmlFor="tp-name">
              <Input id="tp-name" placeholder="Frontend screen" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Default role" htmlFor="tp-role">
              <Input id="tp-role" placeholder="Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="tp-type">
              <Select id="tp-type" value={type} onChange={(e) => setType(e.target.value)}>
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Level" htmlFor="tp-level">
              <Select id="tp-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Duration" htmlFor="tp-dur">
              <Select id="tp-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
                <option value={90}>90 minutes</option>
              </Select>
            </Field>
            <Field label="Format" htmlFor="tp-format">
              <Select id="tp-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Button size="sm" loading={busy} onClick={save}>Save template</Button>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-white/30">No templates yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {templates.map((t) => (
            <li key={t.id} className="group flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[#f0f0f5]">{t.name}</p>
                <p className="truncate text-[12px] text-white/45">
                  {[t.role, t.interview_type, t.level, `${t.duration_minutes} min`, t.format ? FORMAT_LABEL[t.format] : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="rounded-md p-1 text-white/30 opacity-0 transition hover:text-[#f87171] group-hover:opacity-100"
                aria-label="Delete template"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
