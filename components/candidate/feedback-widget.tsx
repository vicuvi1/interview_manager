"use client";

import { useState } from "react";
import { Bug, Lightbulb, MessageSquarePlus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "idea", label: "Idea", icon: Lightbulb },
  { value: "bug", label: "Bug", icon: Bug },
  { value: "other", label: "Other", icon: MessageSquarePlus },
] as const;

/** Floating "Send feedback" button + dialog for candidates. */
export function FeedbackWidget({ userId, name, email }: { userId: string; name: string; email: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (message.trim().length < 4) return setError("Tell us a little more.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("app_feedback").insert({
      user_id: userId,
      name: name || null,
      email: email || null,
      category,
      message: message.trim(),
    });
    setBusy(false);
    if (insertError) {
      setError("Couldn't send — please try again.");
      return;
    }
    toast({ title: "Thanks for the feedback!", description: "We got it — appreciate you.", variant: "success" });
    setMessage("");
    setCategory("idea");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-4 py-3 text-[13px] font-medium text-white shadow-lg shadow-[#6366f1]/30 transition-transform hover:scale-[1.03] active:scale-95"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-4 w-4" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {open ? (
        <Dialog open onClose={() => setOpen(false)} title="Send feedback" description="Found a bug or have an idea? Tell us — it goes straight to the team.">
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-white/55">What kind?</p>
              <div className="flex gap-2">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const active = category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "border-[#6366f1] bg-[#6366f1]/[0.12] text-[#c7d2fe]"
                          : "border-white/10 text-white/60 hover:border-white/20",
                      )}
                    >
                      <Icon className="h-4 w-4" /> {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Your message" htmlFor="fb-message">
              <Textarea
                id="fb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={category === "bug" ? "What happened, and what did you expect?" : "What would make this better for you?"}
                className="min-h-[110px]"
                autoFocus
              />
            </Field>
            {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
            <Button className="w-full" loading={busy} disabled={busy} onClick={submit}>
              <Send className="h-4 w-4" /> Send to the team
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
