"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CalendarPlus, Check, FileText, Send, Upload, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { FORMATS, INTERVIEW_TYPES, LEVELS } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";
import type { CandidateMaterials } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;
const DOC_ACCEPT = ".pdf,.doc,.docx,application/pdf";

const TZ_LIST: string[] = (() => {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === "function") return fn("timeZone");
  } catch {
    /* fall through */
  }
  return [
    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Bucharest",
    "Africa/Cairo", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore",
    "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney",
  ];
})();

function GroupLabel({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

export function InterviewRequestForm({
  userId,
  timezone,
  materials,
  fixedStart,
  onDone,
}: {
  userId: string;
  timezone: string;
  materials: CandidateMaterials;
  /** When booking from the calendar, the time is locked to this slot. */
  fixedStart?: { iso: string; durationMin: number };
  /** Called after a successful submit (used in the calendar dialog). */
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const resumeRef = useRef<HTMLInputElement>(null);
  const jdRef = useRef<HTMLInputElement>(null);

  // Interview
  const [role, setRole] = useState("");
  const [interviewType, setInterviewType] = useState(INTERVIEW_TYPES[0]);
  const [level, setLevel] = useState("Not sure");
  const [focus, setFocus] = useState("");
  const [format, setFormat] = useState("video");
  const [color, setColor] = useState<string | null>(null);
  // When
  const [tz, setTz] = useState(timezone || "UTC");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState(false);
  // Materials
  const [resumePath, setResumePath] = useState<string | null>(materials.resume_path ?? null);
  const [resumeUrl, setResumeUrl] = useState(materials.resume_url ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(materials.portfolio_url ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(materials.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(materials.github_url ?? "");
  const [phone, setPhone] = useState(materials.phone ?? "");
  // Job description
  const [jobDescUrl, setJobDescUrl] = useState("");
  const [jobDescPath, setJobDescPath] = useState<string | null>(null);
  // Context
  const [callerNotes, setCallerNotes] = useState("");
  const [notes, setNotes] = useState("");

  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File, kind: "resume" | "jd"): Promise<string | null> {
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Files must be under 5 MB.", variant: "error" });
      return null;
    }
    setUploading(kind);
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
    const path = kind === "resume" ? `${userId}/resume.${ext}` : `${userId}/jd-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("resumes").upload(path, file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    setUploading(null);
    if (upErr) {
      toast({ title: "Upload failed", description: upErr.message, variant: "error" });
      return null;
    }
    toast({ title: kind === "resume" ? "Résumé uploaded" : "Job description uploaded", variant: "success" });
    return path;
  }

  async function submit() {
    // CV / résumé is the only required field — everything else is optional.
    if (!resumePath && !resumeUrl.trim()) {
      return setError("Please attach your CV / résumé — that's all we need to get started.");
    }
    if (!fixedStart && !when) return setError("Pick a preferred date & time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();

    await supabase
      .from("profiles")
      .update({
        resume_url: resumeUrl.trim() || null,
        resume_path: resumePath,
        portfolio_url: portfolioUrl.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        github_url: githubUrl.trim() || null,
        phone: phone.trim() || null,
      })
      .eq("id", userId);

    const focusAreas = focus.split(",").map((s) => s.trim()).filter(Boolean);
    const { error: insertError } = await supabase.from("interview_requests").insert({
      candidate_id: userId,
      role: role.trim() || interviewType,
      interview_type: interviewType,
      level,
      focus_areas: focusAreas.length ? focusAreas : null,
      format,
      duration_minutes: fixedStart ? fixedStart.durationMin : Math.max(5, Math.min(480, duration)),
      preferred_at: fixedStart ? fixedStart.iso : wallTimeToUtcISO(when, tz),
      job_desc_url: jobDescUrl.trim() || null,
      job_desc_path: jobDescPath,
      caller_notes: callerNotes.trim() || null,
      notes: notes.trim() || null,
      color,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    notifyChanged("interviews");
    toast({ title: "Request submitted", description: "We'll review it and confirm a time.", variant: "success" });
    setBusy(false);
    if (onDone) onDone();
    else router.push("/candidate/interviews");
  }

  const content = (
    <div className="space-y-6">
        {/* Interview */}
        <div className="space-y-4">
          <GroupLabel icon={CalendarPlus}>The interview</GroupLabel>
          <Field label="Role / topic (optional)" htmlFor="ir-role">
            <Input id="ir-role" placeholder="e.g. Senior Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interview type" htmlFor="ir-type">
              <Select id="ir-type" value={interviewType} onChange={(e) => setInterviewType(e.target.value)}>
                {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Level" htmlFor="ir-level">
              <Select id="ir-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Focus areas / skills (optional)" htmlFor="ir-focus" hint="Comma separated.">
            <Input id="ir-focus" placeholder="e.g. React, System design, Algorithms" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Format" htmlFor="ir-format">
              <Select id="ir-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </Field>
            <Field label="Color tag (optional)" htmlFor="ir-color" hint="Shows on this interview in your list & calendar.">
              <div className="pt-1.5">
                <ColorPicker value={color} onChange={setColor} />
              </div>
            </Field>
          </div>
        </div>

        {/* When */}
        <div className="space-y-4">
          <GroupLabel icon={CalendarPlus}>Preferred time</GroupLabel>
          {fixedStart ? (
            <div className="rounded-lg border border-[#6366f1]/25 bg-[#6366f1]/[0.08] px-3.5 py-2.5 text-[13px]">
              <p className="text-white/55">Your selected time</p>
              <p className="mt-0.5 font-medium text-[#f0f0f5]">{formatInTimeZone(fixedStart.iso, timezone)}</p>
              <p className="mt-0.5 text-[12px] text-white/40">{fixedStart.durationMin} minutes · {timezone}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Timezone" htmlFor="ir-tz">
                  <Select id="ir-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                    {TZ_LIST.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                  </Select>
                </Field>
                <Field label="Preferred date & time" htmlFor="ir-when">
                  <Input id="ir-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
              <Field label="Duration" htmlFor="ir-dur">
                <div className="flex gap-2">
                  <Select
                    id="ir-dur"
                    value={customDuration ? "custom" : String(duration)}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        setCustomDuration(true);
                      } else {
                        setCustomDuration(false);
                        setDuration(Number(e.target.value));
                      }
                    }}
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="90">90 minutes</option>
                    <option value="custom">Custom…</option>
                  </Select>
                  {customDuration ? (
                    <Input
                      type="number"
                      min={5}
                      max={480}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value) || 30)}
                      className="w-28"
                      aria-label="Custom minutes"
                      placeholder="min"
                    />
                  ) : null}
                </div>
              </Field>
            </>
          )}
        </div>

        {/* About you */}
        <div className="space-y-4">
          <GroupLabel icon={User}>About you</GroupLabel>
          <p className="-mt-1 text-[12px] text-white/40">Saved to your profile so you don&apos;t retype it next time.</p>

          <DocField
            label="Résumé / CV — required"
            path={resumePath}
            uploading={uploading === "resume"}
            inputRef={resumeRef}
            onPick={async (f) => {
              const p = await upload(f, "resume");
              if (p) setResumePath(p);
            }}
            onRemove={() => setResumePath(null)}
          />
          <Field label="…or link to your résumé (optional)" htmlFor="ir-resume">
            <Input id="ir-resume" placeholder="https://… (optional)" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Portfolio / website (optional)" htmlFor="ir-portfolio">
              <Input id="ir-portfolio" placeholder="https://… (optional)" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} />
            </Field>
            <Field label="LinkedIn (optional)" htmlFor="ir-linkedin">
              <Input id="ir-linkedin" placeholder="https://linkedin.com/in/… (optional)" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
            </Field>
            <Field label="GitHub (optional)" htmlFor="ir-github">
              <Input id="ir-github" placeholder="https://github.com/… (optional)" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
            </Field>
            <Field label="Phone (optional)" htmlFor="ir-phone">
              <Input id="ir-phone" placeholder="Optional" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Job description */}
        <div className="space-y-4">
          <GroupLabel icon={FileText}>Job description</GroupLabel>
          <DocField
            label="Upload the job description"
            path={jobDescPath}
            uploading={uploading === "jd"}
            inputRef={jdRef}
            onPick={async (f) => {
              const p = await upload(f, "jd");
              if (p) setJobDescPath(p);
            }}
            onRemove={() => setJobDescPath(null)}
          />
          <Field label="…or paste a link (optional)" htmlFor="ir-jd-url">
            <Input id="ir-jd-url" placeholder="https://… (optional)" value={jobDescUrl} onChange={(e) => setJobDescUrl(e.target.value)} />
          </Field>
        </div>

        {/* Context */}
        <div className="space-y-4">
          <GroupLabel icon={FileText}>Notes</GroupLabel>
          <Field label="Notes for the caller (optional)" htmlFor="ir-caller" hint="Important info for whoever runs the interview.">
            <Textarea id="ir-caller" value={callerNotes} onChange={(e) => setCallerNotes(e.target.value)} placeholder="e.g. Please focus on backend; I'm interviewing for a fintech role." />
          </Field>
          <Field label="Anything else (optional)" htmlFor="ir-notes" hint="Accommodations, extra links…">
            <Textarea id="ir-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button loading={busy} disabled={busy || uploading !== null} onClick={submit}>
          <Send className="h-4 w-4" /> {fixedStart ? "Request this time" : "Submit request"}
        </Button>
    </div>
  );

  return fixedStart ? (
    content
  ) : (
    <SectionCard title="Request an interview" description="Give us the details — we'll review and confirm." icon={CalendarPlus}>
      {content}
    </SectionCard>
  );
}

function DocField({
  label,
  path,
  uploading,
  inputRef,
  onPick,
  onRemove,
}: {
  label: string;
  path: string | null;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <p className="mb-1.5 block text-[12px] font-medium text-white/55">{label}</p>
      {path ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
          <span className="flex-1 truncate text-[13px] text-white/80">
            <Check className="mr-1 inline h-3.5 w-3.5 text-[#34d399]" />
            {path.split("/").pop()}
          </span>
          <button type="button" onClick={onRemove} className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-[#f87171]" aria-label="Remove file">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-4 text-[13px] text-white/55 transition-colors hover:border-white/25 hover:text-white/80">
          {uploading ? "Uploading…" : (<><Upload className="h-4 w-4" /> Upload a PDF or Word doc (max 5 MB)</>)}
          <input
            ref={inputRef}
            type="file"
            accept={DOC_ACCEPT}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
