import { Globe } from "lucide-react";

import { initials } from "@/lib/utils";

export function WelcomeHeader({
  name,
  email,
  timezone,
}: {
  name: string;
  email: string;
  timezone: string;
}) {
  const firstName = name ? name.split(" ")[0] : "";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-lg font-semibold text-white">
          {initials(name, email)}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[#f0f0f5] sm:text-2xl">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </h1>
          <p className="text-[13px] text-white/55">{email}</p>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-white/[0.06] bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/60">
        <Globe className="h-4 w-4 text-white/40" />
        {timezone}
      </div>
    </div>
  );
}
