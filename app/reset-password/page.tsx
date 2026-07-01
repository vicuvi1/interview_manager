"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

const inputCls =
  "h-10 w-full rounded-lg border border-white/10 bg-[#1a1a24] px-3 text-[13px] text-[#f0f0f5] " +
  "placeholder:text-white/25 transition-colors focus:border-[#6366f1] focus:outline-none " +
  "focus:ring-2 focus:ring-[#6366f1]/25";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white">
            <CalendarClock className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-[18px] font-medium text-[#f0f0f5]">Reset your password</h1>
          <p className="text-[13px] text-white/40">We&apos;ll email you a reset link</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#13131a] p-8">
          {sent ? (
            <div className="flex flex-col items-center py-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10b981]/15 text-[#34d399]">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <p className="mt-3 text-[14px] font-medium text-[#f0f0f5]">Check your email</p>
              <p className="mt-1 text-[12px] text-white/40">
                If an account exists for {email}, a reset link is on its way.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-white/40"
                  htmlFor="email"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </div>
              {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send reset link
              </button>
            </form>
          )}

          <div className="mt-5 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-[12px] text-white/40 transition-colors hover:text-white/70"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
