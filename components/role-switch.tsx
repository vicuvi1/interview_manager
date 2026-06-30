"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, User } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { label: "Candidate", href: "/candidate/dashboard", match: "/candidate", icon: User },
  { label: "Admin", href: "/admin/dashboard", match: "/admin", icon: ShieldCheck },
];

export function RoleSwitch() {
  const pathname = usePathname();

  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {items.map((item) => {
        const active = pathname.startsWith(item.match);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
