"use client";

import { useState } from "react";
import { Save, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

export function SettingsForm({
  userId,
  email,
  initialName,
  initialTimezone,
}: {
  userId: string;
  email: string;
  initialName: string;
  initialTimezone: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [tz, setTz] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);

  async function save() {
    const zone = tz.trim() || "UTC";
    try {
      // Throws on an unknown IANA zone.
      new Intl.DateTimeFormat(undefined, { timeZone: zone });
    } catch {
      toast({
        title: "Invalid timezone",
        description: "Use an IANA name like America/New_York.",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim(), timezone: zone })
      .eq("id", userId);
    setSaving(false);

    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "error" });
      return;
    }
    toast({ title: "Settings saved", variant: "success" });
  }

  return (
    <SectionCard
      title="Your profile"
      description="Update your name and timezone."
      icon={Settings}
    >
      <div className="max-w-md space-y-4">
        <Field label="Email">
          <Input value={email} disabled />
        </Field>
        <Field label="Full name" htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Timezone (IANA)"
          htmlFor="tz"
          hint="e.g. America/New_York, Europe/London, Asia/Tokyo"
        >
          <Input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} />
        </Field>
        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" />
          Save changes
        </Button>
      </div>
    </SectionCard>
  );
}
