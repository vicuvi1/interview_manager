"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/** Opens a file stored in the private "resumes" bucket via a short-lived signed
 *  URL — used so a candidate can re-open their own uploaded résumé / JD. */
export function OpenFileButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const supabase = createClient();
    const { data } = await supabase.storage.from("resumes").createSignedUrl(path, 60);
    setBusy(false);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe] disabled:opacity-50"
    >
      {label} <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
}
