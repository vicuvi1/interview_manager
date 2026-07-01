import { Ban } from "lucide-react";

import { ADMIN_EMAIL } from "@/lib/constants";

export function AccountSuspended({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#13131a] p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#ef4444]/10 text-[#f87171]">
          <Ban className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-lg font-medium text-[#f0f0f5]">Account suspended</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
          Access for <span className="text-white/80">{email}</span> has been paused by an administrator.
          If you think this is a mistake, please get in touch.
        </p>
        <a
          href={`mailto:${ADMIN_EMAIL}?subject=Account%20suspended`}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Contact support
        </a>
      </div>
    </div>
  );
}
