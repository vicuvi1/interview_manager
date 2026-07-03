"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Link2, Loader2, Plus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { ResumeItem } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT = ".pdf,.doc,.docx,application/pdf";

export function ResumeLibraryCard({ userId, uploadsEnabled = true }: { userId: string; uploadsEnabled?: boolean }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<ResumeItem[] | null>(null);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("resume_library")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setItems((data as ResumeItem[] | null) ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Résumés must be under 5 MB.", variant: "error" });
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("resumes").upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (error) return toast({ title: "Upload failed", description: error.message, variant: "error" });
    setPendingPath(path);
    setPendingFileName(file.name);
    setLink("");
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ""));
    toast({ title: "File ready", description: "Give it a name and add it.", variant: "success" });
  }

  async function add() {
    const label = name.trim();
    if (!label) return toast({ title: "Name it first", description: "e.g. Resume 1, Frontend CV…", variant: "error" });
    if (!pendingPath && !link.trim()) {
      return toast({ title: "Add a file or a link", variant: "error" });
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("resume_library").insert({
      user_id: userId,
      name: label,
      file_path: pendingPath,
      file_url: pendingPath ? null : link.trim() || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Couldn't add", description: error.message, variant: "error" });
    setName("");
    setLink("");
    setPendingPath(null);
    setPendingFileName(null);
    toast({ title: `Added “${label}”`, variant: "success" });
    load();
  }

  async function view(item: ResumeItem) {
    if (item.file_url) return window.open(item.file_url, "_blank", "noopener");
    if (!item.file_path) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(item.file_path, 60);
    if (error || !data) return toast({ title: "Couldn't open", description: error?.message, variant: "error" });
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(item: ResumeItem) {
    if (!window.confirm(`Delete “${item.name}” from your résumés?`)) return;
    const supabase = createClient();
    if (item.file_path) await supabase.storage.from("resumes").remove([item.file_path]);
    const { error } = await supabase.from("resume_library").delete().eq("id", item.id);
    if (error) return toast({ title: "Couldn't delete", description: error.message, variant: "error" });
    toast({ title: `Deleted “${item.name}”`, variant: "success" });
    load();
  }

  return (
    <SectionCard
      title="Résumés"
      description="Upload your résumés once, then pick one when you book — no re-uploading."
      icon={FileText}
    >
      <div className="space-y-4">
        {/* Saved list */}
        {items === null ? (
          <div className="flex items-center gap-2 py-2 text-[13px] text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
              >
                {item.file_url ? (
                  <Link2 className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
                )}
                <span className="flex-1 truncate text-[13px] text-white/80">{item.name}</span>
                <button
                  type="button"
                  onClick={() => view(item)}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                >
                  View <ExternalLink className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-[#f87171]"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-[12px] text-white/40">
            No résumés yet. Add one below — you can add several.
          </p>
        )}

        {/* Add new */}
        <div className="space-y-3 rounded-lg bg-white/[0.03] px-3.5 py-3">
          <Field label="Name" htmlFor="rl-name" hint="A label you'll recognise, e.g. “Resume 1”.">
            <Input id="rl-name" placeholder="Resume 1" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          {pendingPath ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] text-white/80">
              <FileText className="h-4 w-4 shrink-0 text-[#34d399]" />
              <span className="flex-1 truncate">{pendingFileName ?? "File ready"}</span>
              <button
                type="button"
                onClick={() => {
                  setPendingPath(null);
                  setPendingFileName(null);
                }}
                className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-[#f87171]"
                aria-label="Discard file"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : uploadsEnabled ? (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-3.5 text-[13px] text-white/55 transition-colors hover:border-white/25 hover:text-white/80">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Upload a PDF or Word doc (max 5 MB)
                </>
              )}
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} disabled={uploading} />
            </label>
          ) : null}

          <Field label="…or link to it" htmlFor="rl-link" hint="Google Drive, Dropbox, etc.">
            <Input
              id="rl-link"
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={!!pendingPath}
            />
          </Field>

          <Button onClick={add} loading={busy} disabled={busy || uploading}>
            <Plus className="h-4 w-4" /> Add résumé
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
