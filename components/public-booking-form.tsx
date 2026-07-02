"use client";

import { useRef, useState } from "react";
import { CalendarCheck, CheckCircle2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { wallTimeToUtcISO } from "@/lib/time";

const tz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

export function PublicBookingForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — real users leave this empty
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const loadedAt = useRef<number>(Date.now());

  async function submit() {
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Please enter a valid email.");
    if (role.trim().length < 2) return setError("Tell us the role or topic.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role: role.trim(),
          preferred_at: when ? wallTimeToUtcISO(when, tz) : null,
          timezone: tz,
          notes: notes.trim() || null,
          website,
          elapsedMs: Date.now() - loadedAt.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data?.error ?? "Sorry — something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setBusy(false);
      setError("Couldn't reach the server. Please try again.");
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#13131a] p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#10b981]/15 text-[#34d399]">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h2 className="text-lg font-medium text-[#f0f0f5]">Request received</h2>
        <p className="mt-1.5 text-[13px] text-white/50">
          Thanks, {name.split(" ")[0]}! We&apos;ll review it and reach out to <span className="text-white/70">{email}</span> to
          confirm a time.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#13131a] p-6 sm:p-7">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#6366f1]/15 text-[#a5b4fc]">
          <CalendarCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-medium text-[#f0f0f5]">Request an interview</h1>
          <p className="text-[12px] text-white/40">No account needed — we&apos;ll follow up to confirm.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name" htmlFor="pb-name">
            <Input id="pb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Email" htmlFor="pb-email">
            <Input id="pb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
        </div>
        <Field label="Role / topic" htmlFor="pb-role">
          <Input id="pb-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Frontend Engineer" />
        </Field>
        <Field label="Preferred time (optional)" htmlFor="pb-when" hint={`Your timezone: ${tz}`}>
          <Input id="pb-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Anything else? (optional)" htmlFor="pb-notes">
          <Textarea id="pb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you'd like to focus on, links, constraints…" />
        </Field>
        {/* Honeypot: hidden from real users; bots that fill it are silently dropped. */}
        <div aria-hidden className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden" tabIndex={-1}>
          <label htmlFor="pb-website">Website</label>
          <input
            id="pb-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
        <Button className="w-full" loading={busy} disabled={busy} onClick={submit}>
          <Send className="h-4 w-4" /> Send request
        </Button>
      </div>
    </div>
  );
}
