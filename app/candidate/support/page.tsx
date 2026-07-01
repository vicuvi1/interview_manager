import { ChevronDown, LifeBuoy, Mail } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { ADMIN_EMAIL } from "@/lib/constants";

export const metadata = { title: "Support" };

const FAQS = [
  {
    q: "How do I book an interview?",
    a: "Go to Book Interview, tell us the role or topic, propose a time in your timezone, and submit. We'll review and confirm.",
  },
  {
    q: "When will my request be confirmed?",
    a: "An admin usually reviews requests within a day. You'll get a notification the moment your time and meeting link are set.",
  },
  {
    q: "How do I join my interview?",
    a: "When it's scheduled, a Join button appears on your dashboard and interviews list. It also pulses in the last 10 minutes before the start time.",
  },
  {
    q: "How do payments work?",
    a: "If an interview has a fee, you'll see a Pay button on your dashboard and interviews list. Paid invoices are marked instantly.",
  },
  {
    q: "Can I reschedule or cancel?",
    a: "You can cancel a pending, approved, or scheduled request from your interviews list. To move a confirmed time, cancel and rebook, or message us below.",
  },
  {
    q: "My times look wrong — how do I fix that?",
    a: "All times follow your profile timezone. Update it under Profile and everything re-renders in your local time.",
  },
];

export default function SupportPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Support</h1>
        <p className="text-[12px] text-white/40">Answers to common questions — and how to reach us.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Frequently asked" description="Tap a question to expand." icon={LifeBuoy} bodyClassName="p-0 sm:p-0">
            <ul className="divide-y divide-white/[0.06]">
              {FAQS.map((f, i) => (
                <li key={i}>
                  <details className="group px-5 py-3.5 sm:px-6">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-medium text-[#f0f0f5]">
                      {f.q}
                      <ChevronDown className="h-4 w-4 shrink-0 text-white/40 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-2 text-[13px] leading-relaxed text-white/55">{f.a}</p>
                  </details>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <SectionCard title="Still need help?" description="We're happy to assist." icon={Mail}>
          <p className="text-[13px] text-white/60">
            Can&apos;t find what you&apos;re looking for? Reach out and we&apos;ll get back to you.
          </p>
          <a
            href={`mailto:${ADMIN_EMAIL}?subject=Interview%20Scheduler%20support`}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Mail className="h-4 w-4" /> Email support
          </a>
          <p className="mt-3 text-center text-[12px] text-white/35">{ADMIN_EMAIL}</p>
        </SectionCard>
      </div>
    </div>
  );
}
