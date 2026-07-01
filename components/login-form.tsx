"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarClock,
  Check,
  KeyRound,
  Loader2,
  type LucideIcon,
  ShieldCheck,
  User,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { browserTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";

const schema = z.object({
  fullName: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "At least 6 characters"),
});
type Values = z.infer<typeof schema>;
type Role = "candidate" | "admin";
type Mode = "signin" | "signup";

const inputCls =
  "h-10 w-full rounded-lg border border-white/10 bg-[#1a1a24] px-3 text-[13px] text-[#f0f0f5] " +
  "placeholder:text-white/25 transition-colors focus:border-[#6366f1] focus:outline-none " +
  "focus:ring-2 focus:ring-[#6366f1]/25";
const labelCls = "mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-white/40";

export function LoginForm() {
  const router = useRouter();

  const [role, setRole] = useState<Role>("candidate");
  const [mode, setMode] = useState<Mode>("signin");
  const [adminCode, setAdminCode] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function callVerify(
    code: string,
    m?: Mode,
  ): Promise<{ valid: boolean; isAdmin?: boolean }> {
    try {
      const res = await fetch("/api/verify-admin-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, mode: m }),
      });
      if (!res.ok) return { valid: false };
      return await res.json();
    } catch {
      return { valid: false };
    }
  }

  function goAdmin() {
    router.replace("/admin/dashboard");
    router.refresh();
  }
  function goCandidate() {
    router.replace("/candidate/dashboard");
    router.refresh();
  }

  async function onVerify() {
    setAdminError(null);
    if (!adminCode.trim()) {
      setAdminError("Enter the access code");
      return;
    }
    setVerifying(true);
    const { valid } = await callVerify(adminCode.trim());
    setVerifying(false);
    if (valid) {
      setRole("admin");
      setVerified(true);
    } else {
      setRole("candidate");
      setVerified(false);
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
      if (role === "admin") {
        const { valid, isAdmin } = await callVerify(adminCode.trim(), "signup");
        if (!valid) {
          setRole("candidate");
          setAdminError("Invalid access code");
          goCandidate();
          return;
        }
        if (!isAdmin) {
          setError("Could not grant admin access — contact the system owner.");
          goCandidate();
          return;
        }
        goAdmin();
        return;
      }
      goCandidate();
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
    if (role === "admin") {
      const { valid, isAdmin } = await callVerify(adminCode.trim(), "signin");
      if (!valid) {
        setRole("candidate");
        setAdminError("Invalid access code");
        goCandidate();
        return;
      }
      if (!isAdmin) {
        setError("This account is not an admin.");
        goCandidate();
        return;
      }
      goAdmin();
      return;
    }
    goCandidate();
  }

  const submitLabel = `Continue as ${role}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white">
            <CalendarClock className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-[18px] font-medium text-[#f0f0f5]">Interview Scheduler Pro</h1>
          <p className="text-[13px] text-white/40">Log in or create your account</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#13131a] p-8">
          <p className={labelCls}>I am joining as</p>
          <div className="grid grid-cols-2 gap-3">
            <RoleCard
              active={role === "candidate"}
              accent="indigo"
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

          <div className="mt-5 inline-flex w-full rounded-lg border border-white/[0.06] bg-[#0f0f13] p-1">
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
                  mode === m ? "bg-[#1a1a24] text-[#f0f0f5]" : "text-white/40 hover:text-white/70",
                )}
              >
                {m === "signin" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
            {mode === "signup" ? (
              <div>
                <label className={labelCls} htmlFor="fullName">
                  Full name
                </label>
                <input id="fullName" className={inputCls} placeholder="Ada Lovelace" {...register("fullName")} />
              </div>
            ) : null}

            <div>
              <label className={labelCls} htmlFor="email">
                Email
              </label>
              <input id="email" type="email" className={inputCls} placeholder="you@example.com" {...register("email")} />
              {errors.email ? (
                <p className="mt-1 text-[11px] text-[#f87171]">{errors.email.message}</p>
              ) : null}
            </div>

            <div>
              <label className={labelCls} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className={inputCls}
                placeholder="••••••••"
                {...register("password")}
              />
              {errors.password ? (
                <p className="mt-1 text-[11px] text-[#f87171]">{errors.password.message}</p>
              ) : null}
              <div className="mt-1.5 text-right">
                <Link
                  href="/reset-password"
                  className="text-[11px] font-medium text-[#a5b4fc] hover:text-[#c7d2fe]"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {error ? <p className="text-[12px] text-[#f87171]">{error}</p> : null}
            {info ? <p className="text-[12px] text-[#34d399]">{info}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span>{submitLabel}</span>
            </button>
          </form>

          <div className="my-5 h-px bg-white/[0.06]" />

          <div className="mb-2 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#a78bfa]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#a78bfa]">
              Admin access
            </span>
          </div>
          <div className="rounded-xl border border-[#8b5cf6]/20 bg-[#8b5cf6]/10 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#8b5cf6]/15 text-[#c4b5fd]">
                <KeyRound className="h-3.5 w-3.5" />
              </span>
              <p className="text-[12px] font-medium text-[#e9e9f0]">Enter admin access code</p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              Required only for admin accounts. Contact the system owner to receive your code.
              Without it you will join as a candidate.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={adminCode}
                onChange={(e) => {
                  setAdminCode(e.target.value);
                  setAdminError(null);
                  setVerified(false);
                }}
                placeholder="Access code"
                className="h-9 w-full rounded-lg border border-white/10 bg-[#0f0f13] px-3 text-[13px] text-[#f0f0f5] placeholder:text-white/25 focus:border-[#8b5cf6] focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/25"
              />
              <button
                type="button"
                onClick={onVerify}
                disabled={verifying}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-[#1a1a24] px-3 text-[13px] font-medium text-[#f0f0f5] transition-colors hover:border-white/20 disabled:opacity-60"
              >
                {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Verify
              </button>
            </div>
            {verified ? (
              <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#34d399]">
                <Check className="h-3.5 w-3.5" />
                Admin access verified
              </p>
            ) : null}
            {adminError ? <p className="mt-2 text-[11px] text-[#f87171]">{adminError}</p> : null}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-white/25">Secured by Supabase Auth</p>
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
  accent: "indigo" | "purple";
  icon: LucideIcon;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  const color = accent === "indigo" ? "#6366f1" : "#8b5cf6";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start rounded-xl border p-3 text-left transition-colors",
        !active && "border-white/[0.06] hover:border-white/20",
      )}
      style={active ? { borderColor: `${color}66`, backgroundColor: `${color}1a` } : undefined}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg",
          !active && "bg-white/5 text-white/40",
        )}
        style={active ? { background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" } : undefined}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="mt-2 text-[13px] font-medium" style={{ color: active ? color : "#f0f0f5" }}>
        {label}
      </span>
      <span className="text-[11px] text-white/40">{subtitle}</span>
    </button>
  );
}
