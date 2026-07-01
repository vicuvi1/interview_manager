"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const LINKS = [
  {
    key: "portal",
    label: "Candidate portal",
    description: "Where candidates sign up or sign in to request interviews.",
    path: "/login",
  },
  {
    key: "book",
    label: "Direct booking link",
    description: "Sends signed-in candidates straight to the booking form.",
    path: "/candidate/book",
  },
];

export function BookingLinks() {
  const { toast } = useToast();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function copy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      toast({ title: "Link copied", variant: "success" });
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Copy it manually.", variant: "error" });
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[#f0f0f5]">Booking links</h1>
        <p className="text-[12px] text-white/40">Share these so candidates can reach you directly.</p>
      </div>

      <SectionCard title="Shareable links" description="Copy and send anywhere." icon={Share2}>
        <div className="space-y-4">
          {LINKS.map((l) => {
            const url = origin ? `${origin}${l.path}` : l.path;
            return (
              <div key={l.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-[#a5b4fc]" />
                  <p className="text-[13px] font-medium text-[#f0f0f5]">{l.label}</p>
                </div>
                <p className="mb-3 text-[12px] text-white/45">{l.description}</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-[#1a1a24] px-3 text-[12px] text-white/70 focus:border-[#6366f1] focus:outline-none"
                  />
                  <Button size="sm" variant="secondary" onClick={() => copy(url, l.key)} className="shrink-0">
                    {copied === l.key ? <Check className="h-4 w-4 text-[#34d399]" /> : <Copy className="h-4 w-4" />}
                    {copied === l.key ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/45">
          Candidates need an account to book — the portal link handles sign-up and sign-in in one place.
        </p>
      </SectionCard>
    </div>
  );
}
