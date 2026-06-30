"use client";

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

// Single shared browser client so every component/realtime channel multiplexes
// over one connection (creating one per call opens redundant websockets).
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

/** Supabase client for Client Components (reads the session from cookies). */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return browserClient;
}
