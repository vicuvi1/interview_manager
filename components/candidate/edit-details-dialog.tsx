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
import { INTERVIEW_TYPES, durationOptions } from "@/lib/interview";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/time";
import type { Attachment, InterviewRequest } from "@/lib/types";

/**
 * Candidate-facing editor for their own interview. Saves via the
 * `edit_my_interview` RPC (SECURITY DEFINER — direct updates are blocked by
 * RLS), which stamps last_edited_at/by and notifies the admins. Used from the
 * "My interviews" list and the schedule calendar.
 */
export function EditDetailsDialog({
  request,
  userId,
  onClose,
}: {
  request: InterviewRequest;
  userId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState(request.role);
  const [notes, setNotes] = useState(request.notes ?? "");
  const [link, setLink] = useState(request.meeting_link ?? "");
  const [itype, setItype] = useState(request.interview_type ?? "");
  const [dur, setDur] = useState<number>(request.duration_minutes);
  const [attachments, setAttachments] = useState<Attachment[]>(request.attachments ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the current value selectable even if it's not in the standard lists.
  const typeOptions = !itype || INTERVIEW_TYPES.includes(itype) ? INTERVIEW_TYPES : [itype, ...INTERVIEW_TYPES];
  const baseDurs = durationOptions();
  const durOptions = baseDurs.includes(dur) ? baseDurs : [...baseDurs, dur].sort((a, b) => a - b);

  async function save() {
    if (!role.trim()) return setError("Role / topic can't be empty.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("edit_my_interview", {
      p_interview_id: request.id,
      p_role: role.trim(),
      p_notes: notes,
      p_meeting_link: link,
      p_attachments: attachments,
      p_interview_type: itype,
      p_duration: dur,
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
    <Dialog open onClose={onClose} title="Edit interview details" description="You can change these anytime.">
      <div className="space-y-4">
        <Field label="Role / topic" htmlFor="ed-role">
          <Input id="ed-role" value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="ed-notes" hint="Anything your interviewer should know.">
          <Textarea id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Meeting link" htmlFor="ed-link" hint="Optional — Zoom / Meet / Teams.">
          <Input id="ed-link" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="ed-type">
            <Select id="ed-type" value={itype} onChange={(e) => setItype(e.target.value)}>
              <option value="">—</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
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
