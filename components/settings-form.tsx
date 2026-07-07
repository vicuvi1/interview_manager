"use client";

import { useState } from "react";
import { Save, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { TimezonePicker } from "@/components/timezone-picker";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone } from "@/lib/time";

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
  const [tz, setTz] = useState(initialTimezone || "local");
  const [saving, setSaving] = useState(false);

  async function save() {
    // The picker's "local" means "match this device"; store the concrete IANA
    // zone so every server-rendered page can format dates in it consistently.
    const zone = tz === "local" ? browserTimeZone() : tz.trim() || "UTC";
    try {
      // Throws on an unknown IANA zone.
      new Intl.DateTimeFormat(undefined, { timeZone: zone });
    } catch {
      toast({
        title: "Invalid timezone",
        description: "Pick a timezone from the list.",
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
    setTz(zone);
    toast({ title: "Settings saved", description: `All dates now show in ${zone}.`, variant: "success" });
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
          label="Timezone"
          hint="Every date and time across the app — calendar, requests, payments — displays in this zone."
        >
          <TimezonePicker value={tz} onChange={setTz} />
        </Field>
        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" />
          Save changes
        </Button>
      </div>
    </SectionCard>
  );
}
