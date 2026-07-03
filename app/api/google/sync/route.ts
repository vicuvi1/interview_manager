import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CRON_SECRET } from "@/lib/google/config";
import {
  buildEventBody,
  deleteEvent,
  findEventByInterview,
  insertEvent,
  type InterviewForEvent,
  listEventsIncremental,
  patchEvent,
} from "@/lib/google/calendar";
import { getValidAccessToken, type GoogleAccountRow } from "@/lib/google/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCOUNT_COLS = "id, user_id, email, access_token, refresh_token, token_expires_at, enabled";

interface CalRow {
  id: string;
  user_id: string;
  account_id: string;
  google_calendar_id: string;
  sync_token?: string | null;
}
interface Job {
  id: number;
  interview_id: string | null;
  op: "upsert" | "delete";
  payload: { calendar_id: string; google_event_id: string }[] | null;
}

async function loadCalWithAccount(
  admin: SupabaseClient,
  calId: string,
): Promise<{ cal: CalRow; account: GoogleAccountRow } | null> {
  const { data: cal } = await admin
    .from("google_calendars")
    .select("id, user_id, account_id, google_calendar_id")
    .eq("id", calId)
    .maybeSingle();
  if (!cal) return null;
  const { data: account } = await admin
    .from("google_accounts")
    .select(ACCOUNT_COLS)
    .eq("id", (cal as CalRow).account_id)
    .maybeSingle();
  const acc = account as GoogleAccountRow | null;
  if (!acc || !acc.enabled) return null;
  return { cal: cal as CalRow, account: acc };
}

async function pushTargetForUser(admin: SupabaseClient, userId: string) {
  const { data: cal } = await admin
    .from("google_calendars")
    .select("id")
    .eq("user_id", userId)
    .eq("is_push_target", true)
    .maybeSingle();
  return cal ? loadCalWithAccount(admin, (cal as { id: string }).id) : null;
}

/** Where this interview's event lives: the interviewer's push target, else any admin's. */
async function resolveTargetCalendar(admin: SupabaseClient, interviewerId: string | null) {
  if (interviewerId) {
    const t = await pushTargetForUser(admin, interviewerId);
    if (t) return t;
  }
  const { data: targets } = await admin
    .from("google_calendars")
    .select("id, user_id")
    .eq("is_push_target", true);
  const list = (targets as { id: string; user_id: string }[] | null) ?? [];
  if (!list.length) return null;
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .in(
      "id",
      list.map((t) => t.user_id),
    )
    .eq("role", "admin");
  const adminIds = new Set(((admins as { id: string }[] | null) ?? []).map((a) => a.id));
  const chosen = list.find((t) => adminIds.has(t.user_id)) ?? list[0];
  return loadCalWithAccount(admin, chosen.id);
}

async function resolveEmails(admin: SupabaseClient, candidateId: string | null, interviewerId: string | null) {
  const ids = [candidateId, interviewerId].filter((x): x is string => Boolean(x));
  if (!ids.length) return { candidate: null as string | null, interviewer: null as string | null };
  const { data } = await admin.from("profiles").select("id, email").in("id", ids);
  const map = Object.fromEntries(((data as { id: string; email: string | null }[] | null) ?? []).map((p) => [p.id, p.email]));
  return {
    candidate: candidateId ? (map[candidateId] ?? null) : null,
    interviewer: interviewerId ? (map[interviewerId] ?? null) : null,
  };
}

async function handleDelete(admin: SupabaseClient, job: Job) {
  let targets = job.payload;
  if (!targets || !targets.length) {
    const { data: links } = await admin
      .from("google_event_links")
      .select("calendar_id, google_event_id")
      .eq("interview_id", job.interview_id)
      .neq("sync_status", "deleted");
    targets = ((links as { calendar_id: string; google_event_id: string }[] | null) ?? []).map((l) => ({
      calendar_id: l.calendar_id,
      google_event_id: l.google_event_id,
    }));
  }
  for (const t of targets) {
    const resolved = await loadCalWithAccount(admin, t.calendar_id);
    if (!resolved) continue;
    const token = await getValidAccessToken(resolved.account, admin);
    if (!token) continue;
    await deleteEvent(token, resolved.cal.google_calendar_id, t.google_event_id);
    await admin
      .from("google_event_links")
      .update({ sync_status: "deleted", updated_at: new Date().toISOString() })
      .eq("calendar_id", t.calendar_id)
      .eq("google_event_id", t.google_event_id);
  }
}

async function handleUpsert(admin: SupabaseClient, job: Job) {
  const { data: ivRow } = await admin
    .from("interview_requests")
    .select("id, role, scheduled_at, duration_minutes, meeting_link, notes, interview_type, status, candidate_id, interviewer_id")
    .eq("id", job.interview_id)
    .maybeSingle();
  const iv = ivRow as
    | (InterviewForEvent & { status: string; candidate_id: string; interviewer_id: string | null })
    | null;
  if (!iv || iv.status !== "scheduled" || !iv.scheduled_at) return; // nothing to sync

  const target = await resolveTargetCalendar(admin, iv.interviewer_id);
  if (!target) return; // no push target configured anywhere — nothing to sync
  const { cal, account } = target;
  const token = await getValidAccessToken(account, admin);
  if (!token) throw new Error("no valid token for push-target account");

  const emails = await resolveEmails(admin, iv.candidate_id, iv.interviewer_id);
  const body = buildEventBody(iv, emails.candidate, emails.interviewer);

  // Target-change cleanup: remove our events on any OTHER calendar for this interview.
  const { data: otherLinks } = await admin
    .from("google_event_links")
    .select("id, calendar_id, google_event_id")
    .eq("interview_id", iv.id)
    .neq("calendar_id", cal.id)
    .neq("sync_status", "deleted");
  for (const ol of (otherLinks as { id: string; calendar_id: string; google_event_id: string }[] | null) ?? []) {
    const other = await loadCalWithAccount(admin, ol.calendar_id);
    if (other) {
      const otok = await getValidAccessToken(other.account, admin);
      if (otok) await deleteEvent(otok, other.cal.google_calendar_id, ol.google_event_id);
    }
    await admin.from("google_event_links").update({ sync_status: "deleted", updated_at: new Date().toISOString() }).eq("id", ol.id);
  }

  const { data: linkRow } = await admin
    .from("google_event_links")
    .select("google_event_id")
    .eq("interview_id", iv.id)
    .eq("calendar_id", cal.id)
    .maybeSingle();

  let eventId = (linkRow as { google_event_id: string } | null)?.google_event_id ?? null;
  let result;
  if (eventId) {
    result = await patchEvent(token, cal.google_calendar_id, eventId, body);
    if (result.status === 404 || result.status === 410) {
      result = await insertEvent(token, cal.google_calendar_id, body); // vanished — recreate
      eventId = result.data?.id ?? null;
    }
  } else {
    const existing = await findEventByInterview(token, cal.google_calendar_id, iv.id); // idempotency
    if (existing) {
      result = await patchEvent(token, cal.google_calendar_id, existing.id, body);
      eventId = existing.id;
    } else {
      result = await insertEvent(token, cal.google_calendar_id, body);
      eventId = result.data?.id ?? null;
    }
  }
  if (!result.ok || !eventId) throw new Error(`Google event write failed (${result.status})`);

  await admin.from("google_event_links").upsert(
    {
      user_id: cal.user_id,
      interview_id: iv.id,
      calendar_id: cal.id,
      google_event_id: eventId,
      html_link: result.data?.htmlLink ?? null,
      etag: result.data?.etag ?? null,
      sync_status: "synced",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "interview_id,calendar_id" },
  );
}

async function drainJobs(admin: SupabaseClient): Promise<number> {
  const { data: jobs } = await admin.rpc("google_claim_sync_jobs", { p_limit: 10 });
  let done = 0;
  for (const job of (jobs as Job[] | null) ?? []) {
    try {
      if (job.op === "delete") await handleDelete(admin, job);
      else await handleUpsert(admin, job);
      await admin
        .from("google_sync_jobs")
        .update({ status: "done", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
      done += 1;
    } catch (e) {
      await admin
        .from("google_sync_jobs")
        .update({ status: "error", last_error: e instanceof Error ? e.message : String(e) })
        .eq("id", job.id);
    }
  }
  return done;
}

async function pullCalendars(admin: SupabaseClient, scopeUserId: string | null): Promise<number> {
  let q = admin
    .from("google_calendars")
    .select("id, user_id, account_id, google_calendar_id, sync_token")
    .eq("selected", true);
  if (scopeUserId) q = q.eq("user_id", scopeUserId);
  const { data: cals } = await q;
  let applied = 0;
  for (const cal of (cals as CalRow[] | null) ?? []) {
    const { data: acctRow } = await admin.from("google_accounts").select(ACCOUNT_COLS).eq("id", cal.account_id).maybeSingle();
    const account = acctRow as GoogleAccountRow | null;
    if (!account || !account.enabled) continue;
    const token = await getValidAccessToken(account, admin);
    if (!token) continue;

    let res = await listEventsIncremental(token, cal.google_calendar_id, cal.sync_token ?? null);
    if (res.needsFullSync) res = await listEventsIncremental(token, cal.google_calendar_id, null);

    for (const ev of res.events) {
      const iid = ev.extendedProperties?.private?.interview_id;
      if (!iid) continue; // not one of ours
      const { data: linkRow } = await admin
        .from("google_event_links")
        .select("id, etag")
        .eq("calendar_id", cal.id)
        .eq("google_event_id", ev.id)
        .maybeSingle();
      const link = linkRow as { id: string; etag: string | null } | null;
      if (!link) continue; // we don't track this event
      if (ev.etag && link.etag && ev.etag === link.etag) continue; // echo of our own push

      if (ev.status === "cancelled") {
        await admin.rpc("google_apply_pull", {
          p_interview_id: iid,
          p_scheduled_at: null,
          p_duration_minutes: null,
          p_cancel: true,
        });
        await admin
          .from("google_event_links")
          .update({ sync_status: "deleted", etag: ev.etag ?? null, last_synced_at: new Date().toISOString() })
          .eq("id", link.id);
        applied += 1;
      } else {
        const dt = ev.start?.dateTime;
        if (!dt) continue; // all-day / date-only — nothing sensible to apply
        const endDt = ev.end?.dateTime;
        const duration = endDt ? Math.max(5, Math.round((new Date(endDt).getTime() - new Date(dt).getTime()) / 60000)) : null;
        await admin.rpc("google_apply_pull", {
          p_interview_id: iid,
          p_scheduled_at: dt,
          p_duration_minutes: duration,
          p_cancel: false,
        });
        await admin
          .from("google_event_links")
          .update({ etag: ev.etag ?? null, last_synced_at: new Date().toISOString() })
          .eq("id", link.id);
        applied += 1;
      }
    }
    if (res.nextSyncToken) {
      await admin.from("google_calendars").update({ sync_token: res.nextSyncToken, updated_at: new Date().toISOString() }).eq("id", cal.id);
    }
  }
  return applied;
}

async function run(request: Request): Promise<NextResponse> {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 500 });

  const headerSecret = request.headers.get("x-sync-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  let scopeUserId: string | null = null;
  if (CRON_SECRET && headerSecret === CRON_SECRET) {
    scopeUserId = null; // cron / nudge → global
  } else {
    const supa = createClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    scopeUserId = user.id; // manual "Sync now" → just this user's calendars
  }

  // Only the privileged cron/nudge path drains the global outbound queue. A
  // session ("Sync now") just pulls that user's own calendars — otherwise any
  // logged-in candidate could drive writes/emails on everyone's calendars.
  const pushed = scopeUserId === null ? await drainJobs(admin) : 0;
  const pulled = await pullCalendars(admin, scopeUserId);
  return NextResponse.json({ ok: true, pushed, pulled });
}

export async function POST(request: Request) {
  return run(request);
}
export async function GET(request: Request) {
  return run(request);
}
