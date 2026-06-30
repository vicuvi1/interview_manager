import { CalendarClock } from "lucide-react";

import { RoleSwitch } from "@/components/role-switch";
import { SignOutButton } from "@/components/sign-out-button";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold text-slate-900">Interview Manager</p>
            <p className="text-[11px] text-slate-400">Scheduling workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RoleSwitch />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
