"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Save, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { BookingProfile } from "@/lib/types";

/** The live form values a profile is saved from / applied to. */
export interface BookingProfileValues {
  full_name: string;
  phone: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  resume_url: string;
  resume_path: string | null;
}

export function BookingProfilesBar({
  userId,
  current,
  onApply,
}: {
  userId: string;
  current: BookingProfileValues;
  onApply: (p: BookingProfile) => void;
}) {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<BookingProfile[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("booking_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("label");
    setProfiles((data as BookingProfile[] | null) ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(id: string) {
    setSelectedId(id);
    if (!id) return;
    const p = profiles?.find((x) => x.id === id);
    if (p) {
      onApply(p);
      toast({ title: `Loaded “${p.label}”`, description: "Fields filled in — review and submit.", variant: "success" });
    }
  }

  function payload() {
    return {
      user_id: userId,
      full_name: current.full_name.trim() || null,
      phone: current.phone.trim() || null,
      linkedin_url: current.linkedin_url.trim() || null,
      github_url: current.github_url.trim() || null,
      portfolio_url: current.portfolio_url.trim() || null,
      resume_url: current.resume_url.trim() || null,
      resume_path: current.resume_path,
    };
  }

  async function saveNew() {
    const name = label.trim();
    if (!name) return toast({ title: "Name this profile first", description: "e.g. Steven, Braden…", variant: "error" });
    setBusy("save");
    const supabase = createClient();
    const { error } = await supabase.from("booking_profiles").insert({ ...payload(), label: name });
    setBusy(null);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    setLabel("");
    toast({ title: `Saved “${name}”`, variant: "success" });
    load();
  }

  async function updateSelected() {
    const p = profiles?.find((x) => x.id === selectedId);
    if (!p) return;
    setBusy("update");
    const supabase = createClient();
    const { error } = await supabase
      .from("booking_profiles")
      .update({ ...payload(), updated_at: new Date().toISOString() })
      .eq("id", p.id);
    setBusy(null);
    if (error) return toast({ title: "Couldn't update", description: error.message, variant: "error" });
    toast({ title: `Updated “${p.label}”`, variant: "success" });
    load();
  }

  async function remove() {
    const p = profiles?.find((x) => x.id === selectedId);
    if (!p) return;
    if (!window.confirm(`Delete saved profile “${p.label}”?`)) return;
    setBusy("delete");
    const supabase = createClient();
    const { error } = await supabase.from("booking_profiles").delete().eq("id", p.id);
    setBusy(null);
    if (error) return toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    setSelectedId("");
    toast({ title: `Deleted “${p.label}”`, variant: "success" });
    load();
  }

  const hasProfiles = (profiles?.length ?? 0) > 0;

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-white/45">
        <UserRound className="h-3.5 w-3.5" />
        Saved profiles
      </div>
      <p className="text-[12px] text-white/40">
        Fill the details once, save them under a name, and load them next time instead of retyping.
      </p>

      {hasProfiles ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <Select value={selectedId} onChange={(e) => apply(e.target.value)} aria-label="Load a saved profile">
              <option value="">Load a saved profile…</option>
              {profiles!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.full_name && p.full_name !== p.label ? ` · ${p.full_name}` : ""}
                </option>
              ))}
            </Select>
          </div>
          {selectedId ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === "update"}
                disabled={busy !== null}
                onClick={updateSelected}
                title="Overwrite this profile with the current field values"
              >
                <RefreshCw className="h-4 w-4" /> Update
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={remove}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <Input
            placeholder={hasProfiles ? "Save current details as… (name)" : "Save these details as… (e.g. Steven)"}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveNew();
              }
            }}
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="secondary" size="sm" loading={busy === "save"} disabled={busy !== null || !label.trim()} onClick={saveNew}>
          <Save className="h-4 w-4" /> Save profile
        </Button>
      </div>
    </div>
  );
}
