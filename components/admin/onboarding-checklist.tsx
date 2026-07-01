"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Link2, Rocket, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Step {
  key: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

const DISMISS_KEY = "im:onboarding-dismissed";

export function OnboardingChecklist() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we check

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: me }, avail, templates, { data: email }] = await Promise.all([
        supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
        supabase.from("availability_slots").select("*", { count: "exact", head: true }),
        supabase.from("interview_templates").select("*", { count: "exact", head: true }),
        supabase.from("app_email_config").select("enabled").eq("id", 1).maybeSingle(),
      ]);

      const tz = (me as { timezone?: string } | null)?.timezone;
      setSteps([
        {
          key: "tz",
          label: "Set your timezone",
          detail: "So interview times show correctly for you.",
          href: "/admin/settings",
          done: !!tz && tz !== "UTC",
        },
        {
          key: "avail",
          label: "Add your availability",
          detail: "Mark the times you're open on the calendar.",
          href: "/admin/calendar",
          done: (avail.count ?? 0) > 0,
        },
        {
          key: "email",
          label: "Turn on email notifications",
          detail: "Email candidates automatically (optional).",
          href: "/admin/settings",
          done: !!(email as { enabled?: boolean } | null)?.enabled,
        },
        {
          key: "template",
          label: "Create an interview template",
          detail: "Speed up bookings with a preset.",
          href: "/admin/settings",
          done: (templates.count ?? 0) > 0,
        },
      ]);
    })();
  }, []);

  if (dismissed || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // fully set up — hide it

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="relative bg-gradient-to-br from-[#6366f1]/[0.12] via-[#8b5cf6]/[0.06] to-transparent p-5 sm:p-6">
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white">
            <Rocket className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-medium text-[#f0f0f5]">Get set up</h2>
            <p className="text-[12px] text-white/45">{doneCount} of {steps.length} done — finish these to hit the ground running.</p>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ul className="mt-4 space-y-1.5">
          {steps.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                  s.done ? "opacity-60" : "hover:bg-white/[0.04]",
                )}
              >
                {s.done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34d399]" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-white/25" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px] font-medium", s.done ? "text-white/50 line-through" : "text-[#f0f0f5]")}>
                    {s.label}
                  </span>
                  {!s.done ? <span className="block text-[12px] text-white/40">{s.detail}</span> : null}
                </span>
                {!s.done ? <ArrowRight className="h-4 w-4 shrink-0 text-white/30" /> : null}
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/admin/booking-links"
          className="mt-3 inline-flex items-center gap-1.5 px-3 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
        >
          <Link2 className="h-3.5 w-3.5" /> Get your shareable booking link
        </Link>
      </div>
    </Card>
  );
}
