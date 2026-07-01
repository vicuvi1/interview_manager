"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PaymentWallet } from "@/lib/types";

export function WalletsManager() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<PaymentWallet[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [asset, setAsset] = useState("");
  const [network, setNetwork] = useState("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("payment_wallets").select("*").order("sort").order("created_at");
    if (data) setWallets(data as PaymentWallet[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!asset.trim() || !address.trim()) {
      toast({ title: "Asset and address are required", variant: "error" });
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("payment_wallets").insert({
      asset: asset.trim().toUpperCase(),
      network: network.trim().toUpperCase() || null,
      address: address.trim(),
      memo: memo.trim() || null,
    });
    setBusy(false);
    if (error) return toast({ title: "Couldn't add", description: error.message, variant: "error" });
    setAsset("");
    setNetwork("");
    setAddress("");
    setMemo("");
    setAdding(false);
    toast({ title: "Wallet added", variant: "success" });
    load();
  }

  async function toggle(w: PaymentWallet) {
    const supabase = createClient();
    await supabase.from("payment_wallets").update({ active: !w.active }).eq("id", w.id);
    load();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("payment_wallets").delete().eq("id", id);
    load();
  }

  return (
    <SectionCard
      title="Receiving wallets"
      description="Addresses candidates pay to. No amount is shown to them."
      icon={Wallet}
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      }
    >
      {adding ? (
        <div className="mb-4 space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Asset" htmlFor="w-asset" hint="e.g. USDT, USDC, BTC">
              <Input id="w-asset" placeholder="USDT" value={asset} onChange={(e) => setAsset(e.target.value)} />
            </Field>
            <Field label="Network" htmlFor="w-net" hint="e.g. BEP20, TRC20, ERC20">
              <Input id="w-net" placeholder="BEP20" value={network} onChange={(e) => setNetwork(e.target.value)} />
            </Field>
          </div>
          <Field label="Address" htmlFor="w-addr">
            <Input id="w-addr" placeholder="0x… / T…" value={address} onChange={(e) => setAddress(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Memo / tag" htmlFor="w-memo" hint="Optional — only some chains need this.">
            <Input id="w-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <Button size="sm" loading={busy} onClick={add}>Save wallet</Button>
        </div>
      ) : null}

      {wallets.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-white/30">No wallets yet — add one so candidates can pay.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {wallets.map((w) => (
            <li key={w.id} className="group flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5b4fc]">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#f0f0f5]">
                  {w.asset}
                  {w.network ? <span className="text-white/45">· {w.network}</span> : null}
                  {!w.active ? <Badge tone="slate">off</Badge> : null}
                </p>
                <p className="truncate font-mono text-[11px] text-white/40">{w.address}</p>
              </div>
              <button
                type="button"
                onClick={() => toggle(w)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  w.active ? "text-white/50 hover:bg-white/[0.06]" : "text-[#34d399] hover:bg-white/[0.06]",
                )}
              >
                {w.active ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                onClick={() => remove(w.id)}
                className="shrink-0 rounded-md p-1 text-white/25 opacity-0 transition hover:text-[#f87171] group-hover:opacity-100"
                aria-label="Delete wallet"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
