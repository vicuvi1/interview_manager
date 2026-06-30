"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarPlus, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { wallTimeToUtcISO } from "@/lib/time";

const schema = z.object({
  role: z.string().min(2, "Tell us the role or topic"),
  preferredAt: z.string().min(1, "Pick a date & time"),
  duration: z.coerce.number().int().min(15).max(480),
  notes: z.string().max(1000).optional(),
});

type FormValues = z.infer<typeof schema>;

export function RequestInterviewCard({
  userId,
  timezone,
}: {
  userId: string;
  timezone: string;
}) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { duration: 30 },
  });

  async function onSubmit(values: FormValues) {
    const supabase = createClient();
    const preferred_at = wallTimeToUtcISO(values.preferredAt, timezone);

    const { error } = await supabase.from("interview_requests").insert({
      candidate_id: userId,
      role: values.role,
      preferred_at,
      duration_minutes: values.duration,
      notes: values.notes?.trim() || null,
    });

    if (error) {
      toast({ title: "Couldn't submit request", description: error.message, variant: "error" });
      return;
    }

    reset({ role: "", preferredAt: "", duration: 30, notes: "" });
    toast({
      title: "Interview requested",
      description: "We'll review it and confirm a time.",
      variant: "success",
    });
  }

  return (
    <SectionCard
      title="Request an interview"
      description="Propose a time and we'll confirm it."
      icon={CalendarPlus}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Role / topic" htmlFor="role" error={errors.role?.message}>
          <Input id="role" placeholder="e.g. Senior Frontend Engineer" {...register("role")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`Preferred date & time (${timezone})`}
            htmlFor="preferredAt"
            error={errors.preferredAt?.message}
          >
            <Input id="preferredAt" type="datetime-local" {...register("preferredAt")} />
          </Field>

          <Field label="Duration" htmlFor="duration" error={errors.duration?.message}>
            <Select id="duration" {...register("duration")}>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Notes"
          htmlFor="notes"
          hint="Optional — anything the interviewer should know."
          error={errors.notes?.message}
        >
          <Textarea id="notes" placeholder="Context, links, accommodations…" {...register("notes")} />
        </Field>

        <div className="pt-1">
          <Button type="submit" loading={isSubmitting}>
            <Send className="h-4 w-4" />
            Submit request
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
