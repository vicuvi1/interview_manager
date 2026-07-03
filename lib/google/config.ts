/**
 * Server-only Google OAuth/Calendar config. Read via process.env so the secret
 * never lands in the client bundle. Do NOT import this from any "use client"
 * module and do NOT move these into lib/env.ts (that file is imported by the
 * browser Supabase client).
 *
 * NOTE: only import this from server route handlers / server components — never
 * from a "use client" module (it reads GOOGLE_CLIENT_SECRET).
 */

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
/** Pin the production callback so it matches the Google Console exactly. */
export const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "";
/** Shared secret gating the internal /api/google/sync route (== google_sync_config.push_secret). */
export const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export function googleConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/** The callback URL: the pinned env value in prod, else derived from the request. */
export function redirectUri(requestOrigin: string): string {
  return GOOGLE_OAUTH_REDIRECT_URI || `${requestOrigin}/api/google/oauth/callback`;
}
