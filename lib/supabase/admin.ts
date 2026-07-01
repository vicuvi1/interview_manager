import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";

/**
 * Server-only Supabase client using the service_role key. It bypasses RLS, so it
 * can set a profile's role (which clients are forbidden from doing). NEVER import
 * this from client code — the key must never reach the browser. Returns null if
 * the key isn't configured.
 */
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !serviceKey) return null;
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
