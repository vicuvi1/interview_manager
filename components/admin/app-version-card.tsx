"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

export function AppVersionCard() {
  const { toast } = useToast();
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await createClient().from("app_settings").select("app_version").eq("id", 1).maybeSingle();
      setVersion((data as { app_version?: string | null } | null)?.app_version ?? null);
    })();
  }, []);

  async function push() {
    setBusy(true);
    const v = `v-${Date.now()}`;
    const { error } = await createClient()
      .from("app_settings")
      .update({ app_version: v, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast({ title: "Couldn't push update", description: error.message, variant: "error" });
    setVersion(v);
    toast({ title: "Update pushed", description: "Everyone with the app open sees an “Update now” banner.", variant: "success" });
  }

  return (
    <SectionCard
      title="App version"
      description="Force everyone to reload to the latest deployed version."
      icon={RefreshCw}
    >
      <div className="space-y-3">
        <p className="text-[13px] text-white/60">
          Current version: <span className="font-mono text-[12px] text-white/80">{version ?? "not set"}</span>
        </p>
        <Button size="sm" loading={busy} disabled={busy} onClick={push}>
          <RefreshCw className="h-4 w-4" /> Push update to everyone
        </Button>
        <p className="text-[11px] text-white/40">
          Deploy your new build first, then click this — connected users get an “Update now” banner and reload to the
          latest version.
        </p>
      </div>
    </SectionCard>
  );
}
