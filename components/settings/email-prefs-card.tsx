"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  userId: string;
  accountEmail: string;
  initialEnabled: boolean;
  initialCustomEmail: string | null;
}

export function EmailPrefsCard({ userId, accountEmail, initialEnabled, initialCustomEmail }: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<"account" | "other">(initialCustomEmail ? "other" : "account");
  const [customEmail, setCustomEmail] = useState(initialCustomEmail ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  // Returns the address that will actually be used, or an error string.
  function resolveTarget(): { email: string } | { error: string } {
    if (mode === "account") {
      if (!accountEmail) return { error: "Your account has no email address." };
      return { email: accountEmail };
    }
    const e = customEmail.trim();
    if (!EMAIL_RE.test(e)) return { error: "Enter a valid email address." };
    return { email: e };
  }

  async function persist(): Promise<string | null> {
    const supabase = createClient();
    const notifyEmail = mode === "other" ? customEmail.trim() : null;
    const { error } = await supabase
      .from("profiles")
      .update({ notify_email_enabled: enabled, notify_email: notifyEmail })
      .eq("id", userId);
    return error ? error.message : null;
  }

  async function save() {
    if (enabled) {
      const target = resolveTarget();
      if ("error" in target) return toast({ title: "Check the email", description: target.error, variant: "error" });
    }
    setBusy("save");
    const err = await persist();
    setBusy(null);
    if (err) return toast({ title: "Couldn't save", description: err, variant: "error" });
    toast({ title: "Email preferences saved", variant: "success" });
  }

  // Save the current choice, then send a test to whatever it resolves to.
  async function sendTest() {
    const target = resolveTarget();
    if ("error" in target) return toast({ title: "Check the email", description: target.error, variant: "error" });
    setBusy("test");
    const err = await persist();
    if (err) {
      setBusy(null);
      return toast({ title: "Couldn't save", description: err, variant: "error" });
    }
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test-me" }),
    });
    const r = await res.json().catch(() => ({}));
    setBusy(null);
    if (r.error) return toast({ title: "Test email failed", description: r.error, variant: "error" });
    toast({ title: "Test email sent", description: `Check ${r.to ?? target.email}.`, variant: "success" });
  }

  return (
    <SectionCard
      title="Email notifications"
      description="Also get your interview updates by email — including scheduled-meeting confirmations."
      icon={Mail}
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-[#1a1a24] accent-[#6366f1]"
          />
          Email me my interview updates
        </label>

        {enabled ? (
          <div className="space-y-3 rounded-lg bg-white/[0.03] px-3.5 py-3">
            <p className="text-[12px] font-medium text-white/60">Send them to:</p>

            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-white/80">
              <input
                type="radio"
                name="email-dest"
                checked={mode === "account"}
                onChange={() => setMode("account")}
                className="mt-0.5 h-4 w-4 border-white/20 bg-[#1a1a24] accent-[#6366f1]"
              />
              <span>
                My account email
                <span className="block text-[12px] text-white/45">{accountEmail || "no email on file"}</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-white/80">
              <input
                type="radio"
                name="email-dest"
                checked={mode === "other"}
                onChange={() => setMode("other")}
                className="mt-0.5 h-4 w-4 border-white/20 bg-[#1a1a24] accent-[#6366f1]"
              />
              <span>A different email</span>
            </label>

            {mode === "other" ? (
              <Field label="Send notifications to" htmlFor="notify-email">
                <Input
                  id="notify-email"
                  type="email"
                  placeholder="you@example.com"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button loading={busy === "save"} disabled={busy !== null} onClick={save}>
            Save
          </Button>
          {enabled ? (
            <Button variant="secondary" loading={busy === "test"} disabled={busy !== null} onClick={sendTest}>
              <Send className="h-4 w-4" /> Send test email
            </Button>
          ) : null}
        </div>

        <p className="text-[11px] text-white/40">
          Emails are sent only if the admin has enabled email delivery. In-app and Telegram notifications are unaffected
          by this setting.
        </p>
      </div>
    </SectionCard>
  );
}
