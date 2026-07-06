"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Search,
  User,
  Users,
  Wallet,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";

interface Item {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  group: string;
  icon?: LucideIcon;
  avatar?: string;
  status?: string;
}

const ADMIN_LINKS: Item[] = [
  { key: "n-dash", label: "Dashboard", href: "/admin/dashboard", group: "Go to", icon: LayoutDashboard },
  { key: "n-req", label: "Requests", href: "/admin/requests", group: "Go to", icon: Inbox },
  { key: "n-cal", label: "Calendar", href: "/admin/calendar", group: "Go to", icon: CalendarDays },
  { key: "n-cand", label: "Candidates", href: "/admin/candidates", group: "Go to", icon: Users },
  { key: "n-pay", label: "Payments", href: "/admin/payments", group: "Go to", icon: CreditCard },
  { key: "n-rev", label: "Revenue", href: "/admin/revenue", group: "Go to", icon: Wallet },
  { key: "n-ana", label: "Analytics", href: "/admin/analytics", group: "Go to", icon: BarChart3 },
];

const CANDIDATE_LINKS: Item[] = [
  { key: "n-dash", label: "My Dashboard", href: "/candidate/dashboard", group: "Go to", icon: LayoutDashboard },
  { key: "n-int", label: "My Interviews", href: "/candidate/interviews", group: "Go to", icon: CalendarDays },
  { key: "n-book", label: "Book Interview", href: "/candidate/book", group: "Go to", icon: Inbox },
  { key: "n-prof", label: "Profile", href: "/candidate/settings", group: "Go to", icon: User },
];

export function CommandPalette({
  open,
  onClose,
  variant,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  variant: "admin" | "candidate";
  userId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const links = variant === "admin" ? ADMIN_LINKS : CANDIDATE_LINKS;

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemote([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Debounced remote search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemote([]);
      return;
    }
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${q}%`;
      const out: Item[] = [];
      if (variant === "admin") {
        const [{ data: people }, { data: reqs }] = await Promise.all([
          supabase.from("profiles").select("id, full_name, email, role").or(`full_name.ilike.${like},email.ilike.${like}`).limit(6),
          supabase.from("interview_requests").select("id, role, status, candidate_id").ilike("role", like).limit(6),
        ]);
        for (const p of (people as { id: string; full_name: string | null; email: string | null; role: string }[] | null) ?? []) {
          if (p.role === "admin") continue;
          out.push({
            key: `p-${p.id}`,
            label: p.full_name || p.email || "Candidate",
            sublabel: p.email ?? undefined,
            href: `/admin/candidates/${p.id}`,
            group: "Candidates",
            avatar: initials(p.full_name, p.email),
          });
        }
        for (const r of (reqs as { id: string; role: string; status: string; candidate_id: string }[] | null) ?? []) {
          out.push({
            key: `r-${r.id}`,
            label: r.role,
            sublabel: "Interview request",
            href: `/admin/candidates/${r.candidate_id}`,
            group: "Requests",
            status: r.status,
            icon: Inbox,
          });
        }
      } else {
        const { data: reqs } = await supabase
          .from("interview_requests")
          .select("id, role, status")
          .eq("candidate_id", userId)
          .ilike("role", like)
          .limit(8);
        for (const r of (reqs as { id: string; role: string; status: string }[] | null) ?? []) {
          out.push({ key: `r-${r.id}`, label: r.role, href: "/candidate/interviews", group: "My interviews", status: r.status, icon: CalendarDays });
        }
      }
      setRemote(out);
      setActive(0);
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open, variant, userId]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filteredLinks = q ? links.filter((l) => l.label.toLowerCase().includes(q)) : links;
    return [...filteredLinks, ...remote];
  }, [links, remote, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const go = (item?: Item) => {
    if (!item) return;
    router.push(item.href);
    onClose();
  };

  // Build ordered groups for rendering.
  const groups: { name: string; rows: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) {
      g = { name: item.group, rows: [] };
      groups.push(g);
    }
    g.rows.push({ item, index });
  });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#13131a] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4">
          <Search className="h-4 w-4 shrink-0 text-white/30" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[active]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder={variant === "admin" ? "Search candidates, requests, pages…" : "Search your interviews and pages…"}
            className="h-12 w-full bg-transparent text-[14px] text-[#f0f0f5] placeholder:text-white/30 focus:outline-none"
          />
          <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto scrollbar-thin p-1.5">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-white/35">
              {query.trim().length >= 2 ? "No matches." : "Type to search…"}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="mb-1">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">{g.name}</p>
                {g.rows.map(({ item, index }) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        index === active ? "bg-[#6366f1]/[0.14]" : "hover:bg-white/[0.04]",
                      )}
                    >
                      {item.avatar ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[10px] font-semibold text-white">
                          {item.avatar}
                        </span>
                      ) : Icon ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/50">
                          <Icon className="h-4 w-4" />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[#f0f0f5]">{item.label}</span>
                        {item.sublabel ? <span className="block truncate text-[12px] text-white/40">{item.sublabel}</span> : null}
                      </span>
                      {item.status ? <StatusBadge status={item.status} /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
