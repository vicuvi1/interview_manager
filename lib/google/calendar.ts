/** Raw-fetch Google Calendar v3 helpers. No SDK. Server-only. */
import { GOOGLE_CALENDAR_BASE } from "@/lib/google/config";

export interface GCalResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

async function gfetch<T = unknown>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<GCalResult<T>> {
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export interface GCalListEntry {
  id: string;
  summary?: string;
  timeZone?: string;
  accessRole?: string;
  primary?: boolean;
}

/** Every calendar visible to the account (paginated). */
export async function listCalendarList(accessToken: string): Promise<GCalListEntry[]> {
  const out: GCalListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ maxResults: "250", minAccessRole: "writer" });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await gfetch<{ items?: GCalListEntry[]; nextPageToken?: string }>(
      accessToken,
      `/users/me/calendarList?${qs.toString()}`,
    );
    if (!r.ok) break;
    for (const it of r.data?.items ?? []) out.push(it);
    pageToken = r.data?.nextPageToken;
  } while (pageToken);
  return out;
}

export interface InterviewForEvent {
  id: string;
  role: string;
  scheduled_at: string;
  duration_minutes: number | null;
  meeting_link: string | null;
  notes: string | null;
  interview_type: string | null;
}

/** Build the Google event body from an interview row + resolved attendee emails. */
export function buildEventBody(iv: InterviewForEvent, candidateEmail?: string | null, interviewerEmail?: string | null) {
  const start = new Date(iv.scheduled_at);
  const end = new Date(start.getTime() + (iv.duration_minutes || 30) * 60000);
  const attendees = [candidateEmail, interviewerEmail]
    .filter((e): e is string => Boolean(e && e.includes("@")))
    .map((email) => ({ email }));
  const descParts = [iv.notes || "", iv.meeting_link ? `Meeting link: ${iv.meeting_link}` : ""].filter(Boolean);
  return {
    summary: `${iv.interview_type ? `${iv.interview_type}: ` : ""}${iv.role}`,
    description: descParts.join("\n\n") || undefined,
    location: iv.meeting_link || undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: attendees.length ? attendees : undefined,
    extendedProperties: { private: { interview_id: iv.id, app: "friday" } },
  };
}

const SEND_ALL = "sendUpdates=all";

/** Idempotency: find an existing event we created for this interview on a calendar. */
export async function findEventByInterview(
  accessToken: string,
  calendarId: string,
  interviewId: string,
): Promise<{ id: string; etag?: string } | null> {
  const qs = new URLSearchParams({
    privateExtendedProperty: `interview_id=${interviewId}`,
    showDeleted: "false",
    maxResults: "1",
  });
  const r = await gfetch<{ items?: { id: string; etag?: string }[] }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
  );
  // Throw on a transient failure so the caller retries the whole job instead of
  // treating "lookup failed" as "no event exists" and inserting a duplicate.
  if (!r.ok) throw new Error(`event lookup failed (${r.status})`);
  const it = r.data?.items?.[0];
  return it ? { id: it.id, etag: it.etag } : null;
}

export function insertEvent(accessToken: string, calendarId: string, body: unknown) {
  return gfetch<{ id: string; etag?: string; htmlLink?: string }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${SEND_ALL}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function patchEvent(accessToken: string, calendarId: string, eventId: string, body: unknown) {
  return gfetch<{ id: string; etag?: string; htmlLink?: string }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${SEND_ALL}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function deleteEvent(accessToken: string, calendarId: string, eventId: string) {
  return gfetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${SEND_ALL}`,
    { method: "DELETE" },
  );
}

export interface GCalEvent {
  id: string;
  etag?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Incremental events pull. Returns changed events + the next sync cursor.
 * needsFullSync=true means the stored syncToken expired (410) — caller should
 * clear it and reseed with a bounded full list.
 */
export async function listEventsIncremental(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
): Promise<{ events: GCalEvent[]; nextSyncToken: string | null; needsFullSync: boolean }> {
  const events: GCalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ maxResults: "250", singleEvents: "true", showDeleted: "true" });
    if (syncToken) qs.set("syncToken", syncToken);
    else qs.set("timeMin", new Date().toISOString()); // reseed: only future events
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await gfetch<{ items?: GCalEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
    );
    if (r.status === 410) return { events: [], nextSyncToken: null, needsFullSync: true };
    if (!r.ok) break;
    for (const it of r.data?.items ?? []) events.push(it);
    pageToken = r.data?.nextPageToken;
    nextSyncToken = r.data?.nextSyncToken ?? nextSyncToken;
    pages += 1;
    // Bounded (250 × 10 = 2500 changes/run) to stay under the serverless timeout.
    // We only persist nextSyncToken when the delta fully drains, so a huge backlog
    // simply advances over several runs rather than losing the cursor.
  } while (pageToken && pages < 10);
  return { events, nextSyncToken, needsFullSync: false };
}
