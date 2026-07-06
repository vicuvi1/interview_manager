"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, FileText, Send, Upload, User, X } from "lucide-react";

import { AttachmentsField } from "@/components/candidate/attachments-field";
import { BookingProfilesBar } from "@/components/candidate/booking-profiles-bar";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { FORMATS, INTERVIEW_TYPES, LEVELS } from "@/lib/interview";
import { type FieldConfig, fieldLevel, levelSuffix } from "@/lib/request-fields";
import { createClient } from "@/lib/supabase/client";
import { formatInTimeZone, wallTimeToUtcISO } from "@/lib/time";
import type { Attachment, BookingProfile, CandidateMaterials, ResumeItem } from "@/lib/types";

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
  busyOverride,
  onDone,
}: {
  userId: string;
  timezone: string;
  materials: CandidateMaterials;
  /** When booking from the calendar, the time is locked to this slot. */
  fixedStart?: { iso: string; durationMin: number };
  /** True when requesting a time the admin marked busy (needs their approval). */
  busyOverride?: boolean;
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
  const [meetingLink, setMeetingLink] = useState("");
  const [color, setColor] = useState<string | null>(null);
  // When
  const [tz, setTz] = useState(timezone || "UTC");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState(false);
  // Materials
  const [name, setName] = useState(materials.full_name ?? "");
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin-configured field requirements (Required / Optional / Hidden).
  const [fields, setFields] = useState<FieldConfig>({});
  const lvl = (k: string) => fieldLevel(fields, k);
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("app_settings").select("request_fields").eq("id", 1).maybeSingle();
      const cfg = (data as { request_fields?: FieldConfig } | null)?.request_fields;
      if (cfg) setFields(cfg);
    })();
  }, []);

  // The user's saved résumé library, to pick from instead of re-uploading.
  const [resumeLib, setResumeLib] = useState<ResumeItem[]>([]);
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("resume_library")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      setResumeLib((data as ResumeItem[] | null) ?? []);
    })();
  }, [userId]);

  function applyResume(id: string) {
    const r = resumeLib.find((x) => x.id === id);
    if (!r) return;
    if (r.file_path) {
      setResumePath(r.file_path);
      setResumeUrl("");
    } else if (r.file_url) {
      setResumeUrl(r.file_url);
      setResumePath(null);
    }
  }

  // Fill the person fields from a saved profile.
  function applyProfile(p: BookingProfile) {
    setName(p.full_name ?? "");
    setPhone(p.phone ?? "");
    setLinkedinUrl(p.linkedin_url ?? "");
    setGithubUrl(p.github_url ?? "");
    setPortfolioUrl(p.portfolio_url ?? "");
    setResumeUrl(p.resume_url ?? "");
    setResumePath(p.resume_path ?? null);
  }

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
    // Enforce whatever the admin marked as required.
    const req = (k: string) => lvl(k) === "required";
    const missing: string[] = [];
    if (req("cv") && !resumePath && !resumeUrl.trim()) missing.push("Résumé / CV");
    if (req("role") && role.trim().length < 2) missing.push("Role / topic");
    if (req("focus") && !focus.trim()) missing.push("Focus areas / skills");
    if (req("job_desc") && !jobDescUrl.trim() && !jobDescPath) missing.push("Job description");
    if (req("caller_notes") && !callerNotes.trim()) missing.push("Notes for the caller");
    if (req("notes") && !notes.trim()) missing.push("Anything else");
    if (req("phone") && !phone.trim()) missing.push("Phone");
    if (req("portfolio") && !portfolioUrl.trim()) missing.push("Portfolio");
    if (req("linkedin") && !linkedinUrl.trim()) missing.push("LinkedIn");
    if (req("github") && !githubUrl.trim()) missing.push("GitHub");
    if (missing.length) return setError(`Please complete: ${missing.join(", ")}.`);
    if (!fixedStart && !when) return setError("Pick a preferred date & time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();

    await supabase
      .from("profiles")
      .update({
        // Only set the name when provided so we never blank an existing account name.
        ...(name.trim() ? { full_name: name.trim() } : {}),
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
      meeting_link: meetingLink.trim() || null,
      busy_override: busyOverride ?? false,
      attachments,
      color,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    notifyChanged("interviews");
    toast({
      title: busyOverride ? "Exception requested" : "Request submitted",
      description: busyOverride
        ? "We've asked the admin about that busy time — you'll hear back once they decide."
        : "We'll review it and confirm a time.",
      variant: "success",
    });
    setBusy(false);
    if (onDone) onDone();
    else router.push("/candidate/interviews");
  }

  const content = (
    <div className="space-y-6">
        <BookingProfilesBar
          userId={userId}
          current={{
            full_name: name,
            phone,
            linkedin_url: linkedinUrl,
            github_url: githubUrl,
            portfolio_url: portfolioUrl,
            resume_url: resumeUrl,
            resume_path: resumePath,
          }}
          onApply={applyProfile}
        />

        {/* Interview */}
        <div className="space-y-4">
          <GroupLabel icon={CalendarPlus}>The interview</GroupLabel>
          {lvl("role") !== "hidden" ? (
            <Field label={`Role / topic${levelSuffix(lvl("role"))}`} htmlFor="ir-role">
              <Input id="ir-role" placeholder="e.g. Senior Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
          ) : null}
          {lvl("interview_type") !== "hidden" || lvl("level") !== "hidden" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {lvl("interview_type") !== "hidden" ? (
                <Field label="Interview type" htmlFor="ir-type">
                  <Select id="ir-type" value={interviewType} onChange={(e) => setInterviewType(e.target.value)}>
                    {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Field>
              ) : null}
              {lvl("level") !== "hidden" ? (
                <Field label="Level" htmlFor="ir-level">
                  <Select id="ir-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Select>
                </Field>
              ) : null}
            </div>
          ) : null}
          {lvl("focus") !== "hidden" ? (
            <Field label={`Focus areas / skills${levelSuffix(lvl("focus"))}`} htmlFor="ir-focus" hint="Comma separated.">
              <Input id="ir-focus" placeholder="e.g. React, System design, Algorithms" value={focus} onChange={(e) => setFocus(e.target.value)} />
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {lvl("format") !== "hidden" ? (
              <Field label="Format" htmlFor="ir-format">
                <Select id="ir-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </Select>
              </Field>
            ) : null}
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
          <Field
            label="Meeting link (optional)"
            htmlFor="ir-meeting"
            hint="Your Zoom / Google Meet / Teams link, if you have one. The admin can also set it."
          >
            <Input
              id="ir-meeting"
              placeholder="https://…"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
            />
          </Field>
        </div>

        {/* About you */}
        <div className="space-y-4">
          <GroupLabel icon={User}>About you</GroupLabel>
          <p className="-mt-1 text-[12px] text-white/40">Saved to your profile so you don&apos;t retype it next time.</p>

          <Field label="Name" htmlFor="ir-name" hint="Who this interview is for.">
            <Input id="ir-name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          {lvl("cv") !== "hidden" ? (
            <>
              {resumeLib.length ? (
                <Field label={`Résumé / CV${levelSuffix(lvl("cv"))}`} htmlFor="ir-resume-lib" hint="Pick a saved résumé, or add a new one below.">
                  <Select id="ir-resume-lib" defaultValue="" onChange={(e) => applyResume(e.target.value)}>
                    <option value="">Choose a saved résumé…</option>
                    {resumeLib.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <DocField
                label={resumeLib.length ? "…or upload a new one" : `Résumé / CV${levelSuffix(lvl("cv"))}`}
                path={resumePath}
                uploading={uploading === "resume"}
                inputRef={resumeRef}
                onPick={async (f) => {
                  const p = await upload(f, "resume");
                  if (p) setResumePath(p);
                }}
                onRemove={() => setResumePath(null)}
              />
              <Field label="…or link to your résumé" htmlFor="ir-resume">
                <Input id="ir-resume" placeholder="https://…" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} />
              </Field>
            </>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {lvl("portfolio") !== "hidden" ? (
              <Field label={`Portfolio / website${levelSuffix(lvl("portfolio"))}`} htmlFor="ir-portfolio">
                <Input id="ir-portfolio" placeholder="https://…" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} />
              </Field>
            ) : null}
            {lvl("linkedin") !== "hidden" ? (
              <Field label={`LinkedIn${levelSuffix(lvl("linkedin"))}`} htmlFor="ir-linkedin">
                <Input id="ir-linkedin" placeholder="https://linkedin.com/in/…" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
              </Field>
            ) : null}
            {lvl("github") !== "hidden" ? (
              <Field label={`GitHub${levelSuffix(lvl("github"))}`} htmlFor="ir-github">
                <Input id="ir-github" placeholder="https://github.com/…" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
              </Field>
            ) : null}
            {lvl("phone") !== "hidden" ? (
              <Field label={`Phone${levelSuffix(lvl("phone"))}`} htmlFor="ir-phone">
                <Input id="ir-phone" placeholder="Your number" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            ) : null}
          </div>
        </div>

        {/* Job description */}
        {lvl("job_desc") !== "hidden" ? (
          <div className="space-y-4">
            <GroupLabel icon={FileText}>Job description{levelSuffix(lvl("job_desc")) === " — required" ? " — required" : ""}</GroupLabel>
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
            <Field label="…or paste a link" htmlFor="ir-jd-url">
              <Input id="ir-jd-url" placeholder="https://…" value={jobDescUrl} onChange={(e) => setJobDescUrl(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {/* Context */}
        {lvl("caller_notes") !== "hidden" || lvl("notes") !== "hidden" ? (
          <div className="space-y-4">
            <GroupLabel icon={FileText}>Notes</GroupLabel>
            {lvl("caller_notes") !== "hidden" ? (
              <Field label={`Notes for the caller${levelSuffix(lvl("caller_notes"))}`} htmlFor="ir-caller" hint="Important info for whoever runs the interview.">
                <Textarea id="ir-caller" value={callerNotes} onChange={(e) => setCallerNotes(e.target.value)} placeholder="e.g. Please focus on backend; I'm interviewing for a fintech role." />
              </Field>
            ) : null}
            {lvl("notes") !== "hidden" ? (
              <Field label={`Anything else${levelSuffix(lvl("notes"))}`} htmlFor="ir-notes" hint="Accommodations, extra links…">
                <Textarea id="ir-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {/* Attachments */}
        <div className="space-y-3">
          <GroupLabel icon={FileText}>Attachments</GroupLabel>
          <p className="-mt-1 text-[12px] text-white/40">Add files or images as context (portfolio samples, screenshots, docs…).</p>
          <AttachmentsField userId={userId} value={attachments} onChange={setAttachments} />
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
