"use client";

import { useState } from "react";
import { CalendarRange, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

/**
 * Reveals the candidate's private .ics subscription URL (lazily minting the
 * token via `ensure_ics_token`) so their interviews stay in sync in Google /
 * Apple / Outlook.
 */
export function CalendarSubscribeCard() {
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("ensure_ics_token");
    setBusy(false);
    if (error || !data) {
      toast({ title: "Couldn't create your feed", description: error?.message, variant: "error" });
      return;
    }
    setUrl(`${window.location.origin}/api/calendar?token=${data}`);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Couldn't copy", description: "Copy it manually.", variant: "error" });
    }
  }

  return (
    <SectionCard
      title="Subscribe in your calendar"
      description="Your scheduled interviews auto-appear in Google / Apple / Outlook and stay in sync."
      icon={CalendarRange}
    >
      <div className="space-y-3">
        {url ? (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-[12px] text-white/80">
                {url}
              </code>
              <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
                {copied ? <Check className="h-4 w-4 text-[#34d399]" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-[12px] text-white/45">
              Add it in your calendar app as a <span className="text-white/70">subscribed / “from URL”</span> calendar.
              Keep this link private — anyone with it can see your scheduled times.
            </p>
          </>
        ) : (
          <Button onClick={reveal} loading={busy} disabled={busy}>
            <CalendarRange className="h-4 w-4" /> Get my calendar link
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
