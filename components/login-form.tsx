"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarClock, KeyRound, type LucideIcon, ShieldCheck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

const ADMIN_PURPLE = "#3c3489";

const schema = z.object({
  fullName: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "At least 6 characters"),
});
type Values = z.infer<typeof schema>;

type Role = "candidate" | "admin";
type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [role, setRole] = useState<Role>("candidate");
  const [mode, setMode] = useState<Mode>("signin");
  const [adminCode, setAdminCode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function checkCode(code: string): Promise<boolean> {
    try {
      const res = await fetch("/api/admin-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { valid?: boolean };
      return !!data.valid;
    } catch {
      return false;
    }
  }

  async function onVerify() {
    setAdminError(null);
    if (!adminCode.trim()) {
      setAdminError("Enter the access code");
      return;
    }
    setVerifying(true);
    const ok = await checkCode(adminCode.trim());
    setVerifying(false);
    if (ok) {
      setRole("admin");
      toast({ title: "Admin access unlocked", variant: "success" });
    } else {
      setRole("candidate");
      setAdminError("Invalid access code");
    }
  }

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
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
    }

    // Admin role must be proven with the access code (verified server-side).
    if (role === "admin") {
      const ok = await checkCode(adminCode.trim());
      if (!ok) {
        setRole("candidate");
        setAdminError("Invalid access code");
        toast({
          title: "Signed in as candidate",
          description: "The admin access code was invalid.",
          variant: "info",
        });
        router.replace("/candidate/dashboard");
        router.refresh();
        return;
      }
      router.replace("/admin/dashboard");
      router.refresh();
      return;
    }

    router.replace("/candidate/dashboard");
    router.refresh();
  }

  async function onForgotPassword() {
    setError(null);
    setInfo(null);
    const email = getValues("email");
    if (!email) {
      setError("Enter your email above, then click Forgot password.");
      return;
    }
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setInfo("Password reset link sent — check your email.");
  }

  const verb = mode === "signin" ? "Sign in" : "Sign up";
  const submitLabel = `${verb} as ${role}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CalendarClock className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">Interview Scheduler Pro</h1>
          <p className="text-[13px] text-slate-500">
            {mode === "signin" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          {/* Role selection */}
          <div className="grid grid-cols-2 gap-3">
            <RoleCard
              active={role === "candidate"}
              accent="blue"
              icon={User}
              label="Candidate"
              subtitle="Book interviews"
              onClick={() => {
                setRole("candidate");
                setAdminError(null);
              }}
            />
            <RoleCard
              active={role === "admin"}
              accent="purple"
              icon={ShieldCheck}
              label="Admin"
              subtitle="Manage interviews"
              onClick={() => setRole("admin")}
            />
          </div>

          {/* Sign in / Sign up tabs */}
          <div className="mt-5 inline-flex w-full rounded-lg border border-slate-200 bg-slate-100 p-0.5">
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
                  mode === m ? "bg-white text-slate-900" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
            {mode === "signup" ? (
              <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
                <Input
                  id="fullName"
                  className="shadow-none"
                  placeholder="Ada Lovelace"
                  {...register("fullName")}
                />
              </Field>
            ) : null}

            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                className="shadow-none"
                placeholder="you@example.com"
                {...register("email")}
              />
            </Field>

            <div>
              <Field label="Password" htmlFor="password" error={errors.password?.message}>
                <Input
                  id="password"
                  type="password"
                  className="shadow-none"
                  placeholder="••••••••"
                  {...register("password")}
                />
              </Field>
              <div className="mt-1.5 text-right">
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="text-[12px] font-medium text-blue-600 hover:text-blue-700"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
            {info ? <p className="text-[13px] text-emerald-600">{info}</p> : null}

            <Button
              type="submit"
              loading={isSubmitting}
              className={cn(
                "w-full capitalize",
                role === "admin"
                  ? "bg-[#3c3489] hover:bg-[#332c73] focus-visible:outline-[#3c3489]"
                  : "bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-600",
              )}
            >
              {submitLabel}
            </Button>
          </form>

          {/* Admin access */}
          <div className="my-5 border-t border-slate-100" />
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: `${ADMIN_PURPLE}33`, backgroundColor: `${ADMIN_PURPLE}0d` }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${ADMIN_PURPLE}1a`, color: ADMIN_PURPLE }}
              >
                <KeyRound className="h-4 w-4" />
              </span>
              <p className="text-[13px] font-semibold" style={{ color: ADMIN_PURPLE }}>
                Admin access
              </p>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
              Enter the admin access code provided by the system owner. Without it you will join as a
              candidate.
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                type="password"
                value={adminCode}
                onChange={(e) => {
                  setAdminCode(e.target.value);
                  setAdminError(null);
                }}
                className="shadow-none focus:border-[#3c3489] focus:ring-[#3c3489]/20"
                placeholder="Access code"
              />
              <Button
                type="button"
                variant="secondary"
                loading={verifying}
                onClick={onVerify}
                className="shrink-0"
              >
                Verify
              </Button>
            </div>
            {adminError ? <p className="mt-1.5 text-[12px] text-red-600">{adminError}</p> : null}
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] text-slate-400">Secured by Supabase Auth</p>
      </div>
    </div>
  );
}

function RoleCard({
  active,
  accent,
  icon: Icon,
  label,
  subtitle,
  onClick,
}: {
  active: boolean;
  accent: "blue" | "purple";
  icon: LucideIcon;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  const isBlue = accent === "blue";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start rounded-xl border p-4 text-left transition-colors",
        active
          ? isBlue
            ? "border-blue-600 bg-blue-50"
            : "border-[#3c3489] bg-[#3c3489]/[0.06]"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          active
            ? isBlue
              ? "bg-blue-600 text-white"
              : "bg-[#3c3489] text-white"
            : "bg-slate-100 text-slate-500",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span
        className={cn(
          "mt-2 text-sm font-semibold",
          active ? (isBlue ? "text-blue-700" : "text-[#3c3489]") : "text-slate-800",
        )}
      >
        {label}
      </span>
      <span className="text-[12px] text-slate-500">{subtitle}</span>
    </button>
  );
}
