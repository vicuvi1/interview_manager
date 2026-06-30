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
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-semibold text-white shadow-sm">
          {initials(name, email)}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </h1>
          <p className="text-[13px] text-slate-500">{email}</p>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-600 shadow-sm">
        <Globe className="h-4 w-4 text-slate-400" />
        {timezone}
      </div>
    </div>
  );
}
