/** Returns a valid access token for a google_accounts row, refreshing if needed. Server-only. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { refreshToken } from "@/lib/google/oauth";

export interface GoogleAccountRow {
  id: string;
  user_id: string;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  enabled: boolean;
}

/**
 * Ensures a fresh access token. Refreshes (and persists) when within 60s of
 * expiry. Returns null when the account can no longer be used (no refresh token,
 * or the refresh was rejected as invalid_grant — in which case the account is
 * marked disabled so it stops being retried). `db` may be the RLS server client
 * (user routes) or the service-role admin client (cron).
 */
export async function getValidAccessToken(
  account: GoogleAccountRow,
  db: SupabaseClient,
): Promise<string | null> {
  if (!account.enabled) return null;
  const expMs = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillValid = account.access_token && expMs > Date.now() + 60_000;
  if (stillValid) return account.access_token;

  if (!account.refresh_token) return null;
  let tokens;
  try {
    tokens = await refreshToken(account.refresh_token);
  } catch {
    return null; // transient network/API error — leave the account enabled, retry next pass
  }
  if (!tokens) {
    // invalid_grant: the user revoked access or the token expired. Disable so we stop hammering Google.
    await db.from("google_accounts").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", account.id);
    return null;
  }
  const newExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const update: Record<string, unknown> = {
    access_token: tokens.access_token,
    token_expires_at: newExpiry,
    updated_at: new Date().toISOString(),
  };
  // Persist a rotated refresh token if Google returns one (guard on truthiness so
  // we never clobber the stored one in the common case where it's omitted).
  if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;
  await db.from("google_accounts").update(update).eq("id", account.id);
  return tokens.access_token;
}
