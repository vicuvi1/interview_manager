import Link from "next/link";
import { ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, FileText } from "lucide-react";

import { AttachmentsField } from "@/components/candidate/attachments-field";
import { CalendarInvite } from "@/components/calendar-invite";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionCard } from "@/components/ui/card";
import { FORMAT_LABEL } from "@/lib/interview";
import { formatInTimeZone } from "@/lib/time";
import type { InterviewRequest } from "@/lib/types";

/**
 * Read-only candidate view of a single interview: the time in their zone, the
 * join link, prep notes, and — once completed — the results/minutes. Nothing
 * here is editable; details are set by the admin.
 */
export function CandidateInterviewView({
  interview: r,
  timezone,
}: {
  interview: InterviewRequest;
  timezone: string;
}) {
  const completed = r.status === "completed";
  const hasResults = completed && (r.actual_minutes || r.completion_notes || r.recording_url);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/candidate/interviews" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white/80">
        <ArrowLeft className="h-4 w-4" /> My interviews
      </Link>

      <SectionCard
        title={r.role}
        description={r.interview_type ?? undefined}
        icon={CalendarClock}
      >
        <div className="space-y-5 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {r.format ? <Badge tone="slate">{FORMAT_LABEL[r.format] ?? r.format}</Badge> : null}
            {r.level ? <Badge tone="slate">{r.level}</Badge> : null}
            <Badge tone={r.payment_status === "paid" ? "green" : "amber"}>{r.payment_status}</Badge>
          </div>

          {r.company ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Company</p>
              <p className="mt-0.5 text-white/80">{r.company}</p>
            </div>
          ) : null}

          <div>
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              {r.scheduled_at ? "Scheduled" : "Requested time"}
            </p>
            <p className="mt-0.5 text-[15px] font-medium text-[#f0f0f5]">
              {formatInTimeZone(r.scheduled_at ?? r.preferred_at, timezone)}
            </p>
            <p className="mt-0.5 text-[12px] text-white/40">{r.duration_minutes} min · {timezone}</p>
          </div>

          {r.status === "scheduled" && r.meeting_link ? (
            <div className="flex flex-wrap items-center gap-3">
              <a href={r.meeting_link} target="_blank" rel="noreferrer">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366f1] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#5457e5]">
                  <ExternalLink className="h-4 w-4" /> Join meeting
                </span>
              </a>
              {r.scheduled_at ? (
                <CalendarInvite
                  title={`Interview: ${r.role}`}
                  startISO={r.scheduled_at}
                  durationMin={r.duration_minutes || 30}
                  location={r.meeting_link}
                  details={`Your interview for "${r.role}".`}
                />
              ) : null}
            </div>
          ) : r.status === "pending" ? (
            <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/50">
              Waiting for your interviewer to confirm a time. You&apos;ll be notified once it&apos;s scheduled.
            </p>
          ) : null}

          {r.notes ? (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Prep notes</p>
              <p className="whitespace-pre-wrap text-white/75">{r.notes}</p>
            </div>
          ) : null}

          {r.attachments && r.attachments.length ? (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Attachments</p>
              <AttachmentsField userId={r.candidate_id} value={r.attachments} readOnly />
            </div>
          ) : null}

          {hasResults ? (
            <div className="rounded-lg border border-[#10b981]/25 bg-[#10b981]/[0.06] p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[#6ee7b7]">
                <CheckCircle2 className="h-4 w-4" /> Interview results
              </p>
              {r.actual_minutes ? <p className="text-white/70">Lasted {r.actual_minutes} min</p> : null}
              {r.recording_url ? (
                <a
                  href={r.recording_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[#a5b4fc] hover:text-[#c7d2fe]"
                >
                  Recording / notes <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {r.completion_notes ? (
                <p className="mt-1.5 whitespace-pre-wrap text-white/75">{r.completion_notes}</p>
              ) : null}
            </div>
          ) : completed ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/50">
              <FileText className="h-3.5 w-3.5" /> This interview is complete. Results will appear here if your interviewer shares them.
            </p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
