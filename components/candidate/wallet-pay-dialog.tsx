"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Loader2, Send, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PaymentWallet } from "@/lib/types";

export function WalletPayDialog({
  interviewId,
  role,
  onClose,
}: {
  interviewId: string;
  role: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<PaymentWallet[] | null>(null);
  const [selected, setSelected] = useState<PaymentWallet | null>(null);
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("payment_wallets")
        .select("*")
        .eq("active", true)
        .order("sort", { ascending: true });
      const list = (data as PaymentWallet[] | null) ?? [];
      setWallets(list);
      if (list.length === 1) setSelected(list[0]);
    })();
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Couldn't copy", description: "Copy it manually.", variant: "error" });
    }
  }

  async function markSent() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter the amount you paid, in dollars.");
      return;
    }
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("notify_payment_sent", {
      p_interview_id: interviewId,
      p_amount: amt,
      p_asset: selected ? walletLabel(selected) : null,
    });
    setBusy(false);
    if (rpcError) return toast({ title: "Couldn't notify", description: rpcError.message, variant: "error" });
    toast({ title: "Thanks — we'll confirm shortly", description: "The team will verify your payment.", variant: "success" });
    onClose();
  }

  const walletLabel = (w: PaymentWallet) => `${w.asset}${w.network ? ` · ${w.network}` : ""}`;

  return (
    <Dialog open onClose={onClose} title="Make a payment" description={role}>
      {wallets === null ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading payment options…
        </div>
      ) : wallets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-[13px] text-white/45">
          No payment methods are set up yet. Please contact the team.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[12px] font-medium text-white/55">Choose how you&apos;d like to pay</p>
            <div className="grid grid-cols-2 gap-2">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    setSelected(w);
                    setCopied(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                    selected?.id === w.id
                      ? "border-[#6366f1] bg-[#6366f1]/[0.1] text-[#f0f0f5]"
                      : "border-white/10 text-white/70 hover:border-white/20",
                  )}
                >
                  <Wallet className="h-4 w-4 shrink-0 text-[#a5b4fc]" />
                  <span className="truncate">{walletLabel(w)}</span>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <div className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="flex justify-center">
                <div className="rounded-lg bg-white p-2.5">
                  <QRCodeSVG value={selected.address} size={132} level="M" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">
                  {walletLabel(selected)} address
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-[12px] text-[#f0f0f5]">
                    {selected.address}
                  </code>
                  <Button size="sm" variant="secondary" onClick={() => copy(selected.address)} className="shrink-0">
                    {copied ? <Check className="h-4 w-4 text-[#34d399]" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              {selected.memo ? (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Memo / tag</p>
                  <code className="block truncate rounded-md bg-[#0f0f13] px-2.5 py-2 font-mono text-[12px] text-[#f0f0f5]">
                    {selected.memo}
                  </code>
                </div>
              ) : null}
              <p className="rounded-md bg-[#f59e0b]/10 px-3 py-2 text-[11px] text-[#fbbf24] ring-1 ring-inset ring-[#f59e0b]/25">
                Send the agreed amount to this address on the <span className="font-medium">{selected.network || selected.asset}</span> network only. Sending on the wrong network can lose your funds.
              </p>
            </div>
          ) : (
            <p className="text-center text-[12px] text-white/35">Pick an option above to see the address.</p>
          )}

          {selected ? (
            <div className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/[0.06] p-3">
              <label htmlFor="pay-amt" className="mb-1 block text-[12px] font-semibold text-[#f87171]">
                Amount you sent (USD) — required
              </label>
              <input
                id="pay-amt"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. 150"
                className="h-10 w-full rounded-lg border border-[#ef4444]/40 bg-[#1a1a24] px-3 text-[13px] text-[#f0f0f5] placeholder:text-white/25 focus:border-[#ef4444] focus:outline-none focus:ring-2 focus:ring-[#ef4444]/25"
              />
              <p className="mt-1 text-[11px] text-[#f87171]">Enter exactly how much you paid, in dollars.</p>
            </div>
          ) : null}
          {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}

          <Button className="w-full" loading={busy} disabled={busy || !selected || !amount.trim()} onClick={markSent}>
            <Send className="h-4 w-4" /> I&apos;ve sent the payment
          </Button>
        </div>
      )}
    </Dialog>
  );
}
