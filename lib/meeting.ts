/** A free, no-setup video room for an interview (Jitsi — no account/API needed). */
export function autoMeetingLink(id: string): string {
  return `https://meet.jit.si/InterviewPro-${id.replace(/-/g, "").slice(0, 12)}`;
}
