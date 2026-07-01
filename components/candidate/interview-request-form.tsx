"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarPlus, FileText, Send, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { FORMATS, INTERVIEW_TYPES, LEVELS } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { wallTimeToUtcISO } from "@/lib/time";
import type { CandidateMaterials } from "@/lib/types";

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
}: {
  userId: string;
  timezone: string;
  materials: CandidateMaterials;
}) {
  const { toast } = useToast();
  const router = useRouter();

  // Interview
  const [role, setRole] = useState("");
  const [interviewType, setInterviewType] = useState(INTERVIEW_TYPES[0]);
  const [level, setLevel] = useState("Not sure");
  const [focus, setFocus] = useState("");
  const [format, setFormat] = useState("video");
  // When
  const [preferredAt, setPreferredAt] = useState("");
  const [duration, setDuration] = useState(30);
  // Materials
  const [resumeUrl, setResumeUrl] = useState(materials.resume_url ?? "");
  const [portfolioUrl, setPortfolioUrl] = useState(materials.portfolio_url ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(materials.linkedin_url ?? "");
  const [githubUrl, setGithubUrl] = useState(materials.github_url ?? "");
  const [phone, setPhone] = useState(materials.phone ?? "");
  // Context
  const [goals, setGoals] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (role.trim().length < 2) return setError("Tell us the role or topic.");
    if (!preferredAt) return setError("Pick a preferred date & time.");
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 1) Keep reusable materials on the profile.
    await supabase
      .from("profiles")
      .update({
        resume_url: resumeUrl.trim() || null,
        portfolio_url: portfolioUrl.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        github_url: githubUrl.trim() || null,
        phone: phone.trim() || null,
      })
      .eq("id", userId);

    // 2) Create the request with all the detail.
    const focusAreas = focus.split(",").map((s) => s.trim()).filter(Boolean);
    const { error: insertError } = await supabase.from("interview_requests").insert({
      candidate_id: userId,
      role: role.trim(),
      interview_type: interviewType,
      level,
      focus_areas: focusAreas.length ? focusAreas : null,
      format,
      duration_minutes: duration,
      preferred_at: wallTimeToUtcISO(preferredAt, timezone),
      goals: goals.trim() || null,
      notes: notes.trim() || null,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    notifyChanged("interviews");
    toast({ title: "Request submitted", description: "We'll review it and confirm a time.", variant: "success" });
    setBusy(false);
    router.push("/candidate/interviews");
  }

  return (
    <SectionCard title="Request an interview" description="Give us the details — we'll review and confirm." icon={CalendarPlus}>
      <div className="space-y-6">
        {/* Interview */}
        <div className="space-y-4">
          <GroupLabel icon={CalendarPlus}>The interview</GroupLabel>
          <Field label="Role / topic" htmlFor="ir-role">
            <Input id="ir-role" placeholder="e.g. Senior Frontend Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interview type" htmlFor="ir-type">
              <Select id="ir-type" value={interviewType} onChange={(e) => setInterviewType(e.target.value)}>
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Level" htmlFor="ir-level">
              <Select id="ir-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Focus areas / skills" htmlFor="ir-focus" hint="Comma-separated, e.g. React, System design, Leadership">
            <Input id="ir-focus" placeholder="React, TypeScript, System design" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Format" htmlFor="ir-format">
              <Select id="ir-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Preferred (${timezone})`} htmlFor="ir-when">
              <Input id="ir-when" type="datetime-local" value={preferredAt} onChange={(e) => setPreferredAt(e.target.value)} />
            </Field>
            <Field label="Duration" htmlFor="ir-dur">
              <Select id="ir-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes</option>
                <option value={90}>90 minutes</option>
              </Select>
            </Field>
          </div>
        </div>

        {/* Materials */}
        <div className="space-y-4">
          <GroupLabel icon={User}>About you</GroupLabel>
          <p className="-mt-1 text-[12px] text-white/40">Saved to your profile so you don&apos;t retype it next time.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Résumé / CV link" htmlFor="ir-resume">
              <Input id="ir-resume" placeholder="https://…" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} />
            </Field>
            <Field label="Portfolio / website" htmlFor="ir-portfolio">
              <Input id="ir-portfolio" placeholder="https://…" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} />
            </Field>
            <Field label="LinkedIn" htmlFor="ir-linkedin">
              <Input id="ir-linkedin" placeholder="https://linkedin.com/in/…" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} />
            </Field>
            <Field label="GitHub" htmlFor="ir-github">
              <Input id="ir-github" placeholder="https://github.com/…" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="ir-phone" hint="Optional.">
              <Input id="ir-phone" placeholder="+1 555 000 1234" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Context */}
        <div className="space-y-4">
          <GroupLabel icon={FileText}>Context</GroupLabel>
          <Field label="Goals for this interview" htmlFor="ir-goals" hint="What do you want to focus on or get out of it?">
            <Textarea id="ir-goals" value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. Practice system design and get feedback on trade-offs." />
          </Field>
          <Field label="Anything else" htmlFor="ir-notes" hint="Context, accommodations, links…">
            <Textarea id="ir-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button loading={busy} onClick={submit}>
          <Send className="h-4 w-4" /> Submit request
        </Button>
      </div>
    </SectionCard>
  );
}
