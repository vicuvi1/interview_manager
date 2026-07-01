import { redirect } from "next/navigation";
import { CalendarClock, CheckCircle2, MessageSquare } from "lucide-react";

import { RequestInterviewCard } from "@/components/request-interview-card";
import { SectionCard } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Book Interview" };

const STEPS = [
  { icon: MessageSquare, title: "Tell us what you need", detail: "Share the role or topic, a preferred time, and any context." },
  { icon: CheckCircle2, title: "We review & approve", detail: "An admin confirms your request, usually within a day." },
  { icon: CalendarClock, title: "Get your time & link", detail: "You'll be notified with the confirmed time and a join link." },
];

export default async function BookInterviewPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const timezone = (profileRow as Profile | null)?.timezone || "UTC";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Book an interview</h1>
        <p className="text-[12px] text-white/40">Propose a time — we&apos;ll confirm it and send a link.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RequestInterviewCard userId={user.id} timezone={timezone} />
        </div>
        <SectionCard title="How it works" description="Three quick steps." icon={CalendarClock}>
          <ol className="space-y-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={i} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[#a5b4fc]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-[#f0f0f5]">
                      <span className="mr-1 text-white/30">{i + 1}.</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-[12px] text-white/50">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/50">
            Times are shown in your timezone (<span className="text-white/70">{timezone}</span>). Update it under Profile.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
