"use client";

import { useState } from "react";
import { CreditCard, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/utils";
import type { InterviewRequest } from "@/lib/types";

export function CheckoutDialog({
  interview,
  open,
  onClose,
  onPaid,
}: {
  interview: InterviewRequest | null;
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");

  if (!interview) return null;
  const amount = formatMoney(interview.price_cents, interview.currency);

  async function pay() {
    if (!interview) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("interview_requests")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", interview.id);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    await supabase.from("notifications").insert({
      user_id: interview.candidate_id,
      title: "Payment confirmed",
      detail: `Your payment of ${amount} for "${interview.role}" was received.`,
      type: "success",
    });

    setBusy(false);
    setCard("");
    setExp("");
    setCvc("");
    toast({ title: "Payment successful", description: `${amount} paid.`, variant: "success" });
    onPaid();
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Checkout" description={interview.role}>
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700 ring-1 ring-inset ring-amber-600/20">
          Demo checkout — no real card is charged.
        </div>

        <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-500">Amount due</span>
          <span className="text-2xl font-semibold text-slate-900">{amount}</span>
        </div>

        <Field label="Card number" htmlFor="card">
          <Input
            id="card"
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiry" htmlFor="exp">
            <Input id="exp" placeholder="MM / YY" value={exp} onChange={(e) => setExp(e.target.value)} />
          </Field>
          <Field label="CVC" htmlFor="cvc">
            <Input id="cvc" placeholder="123" value={cvc} onChange={(e) => setCvc(e.target.value)} />
          </Field>
        </div>

        {error ? <p className="text-[13px] text-red-600">{error}</p> : null}

        <Button className="w-full" loading={busy} onClick={pay}>
          <Lock className="h-4 w-4" />
          Pay {amount}
        </Button>
        <p className="flex items-center justify-center gap-1 text-[12px] text-slate-400">
          <CreditCard className="h-3.5 w-3.5" />
          Secured demo payment
        </p>
      </div>
    </Dialog>
  );
}
