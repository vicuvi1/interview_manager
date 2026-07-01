"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

interface Status {
  enabled: boolean;
  emailFrom: string;
  hasKey: boolean;
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

export function EmailCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/email", { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    setEmailFrom(s.emailFrom);
    setEnabled(s.enabled);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function save() {
    setBusy("save");
    const r = await call("save", { apiKey: apiKey.trim() || undefined, emailFrom, enabled });
    setBusy(null);
    if (r.error) return toast({ title: "Couldn't save", description: r.error, variant: "error" });
    setApiKey("");
    toast({ title: "Email settings saved", variant: "success" });
    refresh();
  }

  async function test() {
    setBusy("test");
    const r = await call("test");
    setBusy(null);
    if (r.error) return toast({ title: "Test failed", description: r.error, variant: "error" });
    toast({ title: "Test email sent", description: r.to ? `Check ${r.to}` : undefined, variant: "success" });
  }

  return (
    <SectionCard title="Email notifications" description="Email every notification via Resend." icon={Mail}>
      {status === null ? (
        <div className="flex items-center gap-2 py-4 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-white/70">
            {status.hasKey ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-[#34d399]" /> API key set
                {status.enabled ? <Badge tone="green">on</Badge> : <Badge tone="slate">off</Badge>}
              </>
            ) : (
              <Badge tone="amber">not configured</Badge>
            )}
          </div>

          <ol className="space-y-1 text-[12px] text-white/50">
            <li>1. Create an API key at <span className="text-white/80">resend.com</span> (and verify a sending domain).</li>
            <li>2. Paste the key, set your “from” address, enable, and save.</li>
          </ol>

          <Field label="Resend API key" htmlFor="em-key" hint={status.hasKey ? "Leave blank to keep the current key." : "Starts with re_…"}>
            <Input id="em-key" type="password" placeholder={status.hasKey ? "•••••••• (set)" : "re_…"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="From address" htmlFor="em-from" hint="Use a verified domain, e.g. Interviews <no-reply@yourdomain.com>.">
            <Input id="em-from" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
            />
            Send emails for notifications
          </label>

          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "save"} disabled={busy !== null} onClick={save}>
              Save
            </Button>
            <Button variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={test}>
              <Send className="h-4 w-4" /> Send test
            </Button>
          </div>

          <p className="rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/40">
            Delivery runs in Postgres via pg_net (same extension as Telegram). Enable it in Supabase if you haven&apos;t already.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
