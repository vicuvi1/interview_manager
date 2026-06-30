"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

const schema = z.object({
  fullName: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "At least 6 characters"),
});

type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const next = "/candidate/dashboard";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setError(null);
    setInfo(null);
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: { full_name: values.fullName || "", timezone: browserTimeZone() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
        return;
      }
      router.replace(next);
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <CalendarClock className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Interview Manager</h1>
          <p className="text-[13px] text-slate-500">
            {mode === "signin" ? "Sign in to your dashboard" : "Create your account"}
          </p>
        </div>

        <Card className="p-6">
          <div className="mb-5 inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setInfo(null);
                }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  mode === m
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {mode === "signup" ? (
              <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
                <Input id="fullName" placeholder="Ada Lovelace" {...register("fullName")} />
              </Field>
            ) : null}

            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                {...register("password")}
              />
            </Field>

            {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
            {info ? <p className="text-[13px] text-emerald-600">{info}</p> : null}

            <Button type="submit" className="w-full" loading={isSubmitting}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-[12px] text-slate-400">Secured by Supabase Auth</p>
      </div>
    </div>
  );
}
