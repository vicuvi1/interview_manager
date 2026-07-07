"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { AttachmentsField } from "@/components/candidate/attachments-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { notifyChanged } from "@/lib/bus";
import { FORMATS, INTERVIEW_TYPES, LEVELS, durationOptions } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import type { Attachment, InterviewRequest } from "@/lib/types";

/** The subset of an interview this dialog reads — so calendar row types
 *  (which carry only a few columns) can open it without the full record. */
export type EditableInterview = Pick<
  InterviewRequest,
  | "id"
  | "role"
  | "company"
  | "interviewer_name"
  | "notes"
  | "caller_notes"
  | "meeting_link"
  | "interview_type"
  | "level"
  | "format"
  | "focus_areas"
  | "duration_minutes"
  | "attachments"
  | "last_edited_at"
>;

/**
 * Candidate-facing editor for their own interview. Saves via the
 * `edit_my_interview` RPC (SECURITY DEFINER — direct updates are blocked by
 * RLS), which stamps last_edited_at/by and notifies the admins. Every
 * interview-specific field is editable here, not just the basics. Used from the
 * "My interviews" list and both candidate calendars.
 */
export function EditDetailsDialog({
  request,
  userId,
  onClose,
}: {
  request: EditableInterview;
  userId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState(request.role);
  const [company, setCompany] = useState(request.company ?? "");
  const [interviewerName, setInterviewerName] = useState(request.interviewer_name ?? "");
  const [itype, setItype] = useState(request.interview_type ?? "");
  const [level, setLevel] = useState(request.level ?? "");
  const [format, setFormat] = useState(request.format ?? "");
  const [dur, setDur] = useState<number>(request.duration_minutes);
  const [focus, setFocus] = useState((request.focus_areas ?? []).join(", "));
  const [link, setLink] = useState(request.meeting_link ?? "");
  const [callerNotes, setCallerNotes] = useState(request.caller_notes ?? "");
  const [notes, setNotes] = useState(request.notes ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(request.attachments ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the current value selectable even if it's not in the standard lists.
  const typeOptions = !itype || INTERVIEW_TYPES.includes(itype) ? INTERVIEW_TYPES : [itype, ...INTERVIEW_TYPES];
  const levelOptions = !level || LEVELS.includes(level) ? LEVELS : [level, ...LEVELS];
  const baseDurs = durationOptions();
  const durOptions = baseDurs.includes(dur) ? baseDurs : [...baseDurs, dur].sort((a, b) => a - b);

  async function save() {
    if (!role.trim()) return setError("Role / topic can't be empty.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const focusAreas = focus.split(",").map((s) => s.trim()).filter(Boolean);
    const { error: rpcError } = await supabase.rpc("edit_my_interview", {
      p_interview_id: request.id,
      p_role: role.trim(),
      p_notes: notes,
      p_meeting_link: link,
      p_attachments: attachments,
      p_interview_type: itype,
      p_duration: dur,
      p_company: company,
      p_level: level,
      p_format: format,
      p_focus_areas: focusAreas,
      p_caller_notes: callerNotes,
      p_interviewer_name: interviewerName,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast({ title: "Details updated", description: "Your interviewer has been notified.", variant: "success" });
    notifyChanged("interviews");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Edit interview details" description="You can change any of these anytime.">
      <div className="space-y-4">
        <Field label="Role / topic" htmlFor="ed-role">
          <Input id="ed-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" htmlFor="ed-company">
            <Input id="ed-company" placeholder="e.g. Acme Corp" value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label="Interviewer name" htmlFor="ed-interviewer" hint="Optional.">
            <Input id="ed-interviewer" placeholder="e.g. Jordan Lee" value={interviewerName} onChange={(e) => setInterviewerName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="ed-type">
            <Select id="ed-type" value={itype} onChange={(e) => setItype(e.target.value)}>
              <option value="">—</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Level" htmlFor="ed-level">
            <Select id="ed-level" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">—</option>
              {levelOptions.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format" htmlFor="ed-format">
            <Select id="ed-format" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">—</option>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Duration" htmlFor="ed-dur">
            <Select id="ed-dur" value={String(dur)} onChange={(e) => setDur(Number(e.target.value))}>
              {durOptions.map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Focus areas / skills" htmlFor="ed-focus" hint="Comma separated.">
          <Input id="ed-focus" placeholder="e.g. React, System design" value={focus} onChange={(e) => setFocus(e.target.value)} />
        </Field>
        <Field label="Meeting link" htmlFor="ed-link" hint="Optional — Zoom / Meet / Teams.">
          <Input id="ed-link" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        <Field label="Notes for the interviewer" htmlFor="ed-caller" hint="Important context for whoever runs it.">
          <Textarea id="ed-caller" value={callerNotes} onChange={(e) => setCallerNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Anything else" htmlFor="ed-notes" hint="Accommodations, extra links…">
          <Textarea id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-white/55">Attachments</p>
          <AttachmentsField userId={userId} value={attachments} onChange={setAttachments} />
        </div>
        {request.last_edited_at ? (
          <p className="text-[11px] text-white/35">Last edited {relativeTime(request.last_edited_at)}.</p>
        ) : null}
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy} onClick={save}>
          <Pencil className="h-4 w-4" /> Save changes
        </Button>
      </div>
    </Dialog>
  );
}
