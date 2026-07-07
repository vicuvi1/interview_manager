"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bell, CalendarPlus, Check, FileText, Rocket, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "cand-onboarding-dismissed";

/**
 * First-run "getting started" guide for new candidates. Auto-hides once the two
 * core steps (profile + first booking) are done, and can be dismissed. Purely
 * client-side (a localStorage flag) — no data written.
 */
export function OnboardingChecklist({
  hasResume,
  hasInterview,
}: {
  hasResume: boolean;
  hasInterview: boolean;
}) {
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage (avoids a flash)

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  // Nothing to nudge once the core steps are done.
  if (dismissed || (hasResume && hasInterview)) return null;

  const steps = [
    {
      done: hasResume,
      icon: FileText,
      title: "Add your details & résumé",
      desc: "So your interviewer knows who they're meeting.",
      href: "/candidate/settings",
      cta: "Complete profile",
    },
    {
      done: hasInterview,
      icon: CalendarPlus,
      title: "Book your first interview",
      desc: "Pick an open time or send a detailed request.",
      href: "/candidate/book",
      cta: "Book now",
    },
    {
      done: false,
      icon: Bell,
      title: "Turn on reminders",
      desc: "Get an email / Telegram nudge before each interview.",
      href: "/candidate/settings",
      cta: "Set up",
      optional: true,
    },
  ];

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="relative overflow-hidden">
      <div className="bg-gradient-to-br from-[#6366f1]/[0.12] via-[#8b5cf6]/[0.06] to-transparent p-5 sm:p-6">
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#6366f1]/20 text-[#a5b4fc]">
            <Rocket className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-medium text-[#f0f0f5]">Get started</h2>
            <p className="text-[12px] text-white/45">{doneCount} of {steps.length} done · takes a minute</p>
          </div>
        </div>
        <ul className="space-y-2">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.title}>
                <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                      s.done ? "bg-[#10b981] text-white" : "bg-white/[0.06] text-white/50",
                    )}
                  >
                    {s.done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] font-medium", s.done ? "text-white/50 line-through" : "text-[#f0f0f5]")}>
                      {s.title}
                      {s.optional ? <span className="ml-1.5 text-[11px] font-normal text-white/35">optional</span> : null}
                    </p>
                    {!s.done ? <p className="truncate text-[12px] text-white/45">{s.desc}</p> : null}
                  </div>
                  {!s.done ? (
                    <Link
                      href={s.href}
                      className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                    >
                      {s.cta} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
