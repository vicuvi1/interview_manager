"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileText, Save, Trash2, Upload, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { CandidateMaterials } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function ProfileMaterialsForm({
  userId,
  initial,
}: {
  userId: string;
  initial: CandidateMaterials;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phone, setPhone] = useState(initial.phone ?? "");
  const [resumeUrl, setResumeUrl] = useState(initial.resume_url ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(initial.portfolio_url ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(initial.github_url ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [resumePath, setResumePath] = useState<string | null>(initial.resume_path ?? null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        phone: phone.trim() || null,
        resume_url: resumeUrl.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        github_url: githubUrl.trim() || null,
        bio: bio.trim() || null,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "error" });
    toast({ title: "Profile saved", variant: "success" });
  }

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
    const path = `${userId}/resume.${ext}`;
    const { error } = await supabase.storage.from("resumes").upload(path, file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    if (error) {
      setUploading(false);
      toast({ title: "Upload failed", description: error.message, variant: "error" });
      return;
    }
    // Drop a previous file with a different extension so only one résumé remains.
    if (resumePath && resumePath !== path) {
      await supabase.storage.from("resumes").remove([resumePath]);
    }
    await supabase.from("profiles").update({ resume_path: path }).eq("id", userId);
    setResumePath(path);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    toast({ title: "Résumé uploaded", variant: "success" });
  }

  async function viewResume() {
    if (!resumePath) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(resumePath, 60);
    if (error || !data) return toast({ title: "Couldn't open", description: error?.message, variant: "error" });
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function removeResume() {
    if (!resumePath) return;
    if (!window.confirm("Remove your uploaded résumé?")) return;
    const supabase = createClient();
    await supabase.storage.from("resumes").remove([resumePath]);
    await supabase.from("profiles").update({ resume_path: null }).eq("id", userId);
    setResumePath(null);
    toast({ title: "Résumé removed", variant: "success" });
  }

  return (
    <SectionCard
      title="Profile & materials"
      description="Shared with the interviewer, and reused on your next request."
      icon={User}
    >
      <div className="space-y-5">
        {/* Résumé upload */}
        <div>
          <p className="mb-2 text-[12px] font-medium text-white/55">Résumé / CV</p>
          {resumePath ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
              <span className="flex-1 truncate text-[13px] text-white/80">Résumé on file</span>
              <button type="button" onClick={viewResume} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]">
                View <ExternalLink className="h-3 w-3" />
              </button>
              <button type="button" onClick={removeResume} className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-[#f87171]" aria-label="Remove résumé">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-4 text-[13px] text-white/55 transition-colors hover:border-white/25 hover:text-white/80">
              {uploading ? "Uploading…" : (
                <>
                  <Upload className="h-4 w-4" /> Upload a PDF or Word doc (max 5 MB)
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden" onChange={onFile} disabled={uploading} />
            </label>
          )}
          <Field label="…or link to it" htmlFor="pm-resume" hint="Google Drive, Dropbox, etc.">
            <Input id="pm-resume" placeholder="https://…" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Portfolio / website" htmlFor="pm-portfolio">
            <Input id="pm-portfolio" placeholder="https://…" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} />
          </Field>
          <Field label="LinkedIn" htmlFor="pm-linkedin">
            <Input id="pm-linkedin" placeholder="https://linkedin.com/in/…" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
          </Field>
          <Field label="GitHub" htmlFor="pm-github">
            <Input id="pm-github" placeholder="https://github.com/…" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="pm-phone">
            <Input id="pm-phone" placeholder="+1 555 000 1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <Field label="Short bio" htmlFor="pm-bio" hint="A sentence or two about you.">
          <Textarea id="pm-bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>

        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" /> Save profile
        </Button>
      </div>
    </SectionCard>
  );
}
