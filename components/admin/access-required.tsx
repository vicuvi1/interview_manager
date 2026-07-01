import { ShieldAlert } from "lucide-react";

export function AccessRequired({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#13131a] p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f59e0b]/10 text-[#fbbf24]">
            <ShieldAlert className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h1 className="text-sm font-medium text-[#f0f0f5]">Admin access required</h1>
            <p className="text-[12px] text-white/40">Your account isn&apos;t an admin yet.</p>
          </div>
        </div>
        <p className="mt-4 text-[13px] text-white/60">
          Grant yourself the admin role by running this in the Supabase SQL editor, then reload:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0f0f13] p-3 text-[12px] leading-relaxed text-[#a5b4fc]">
          {`update public.profiles\nset role = 'admin'\nwhere email = '${email || "you@example.com"}';`}
        </pre>
      </div>
    </div>
  );
}
