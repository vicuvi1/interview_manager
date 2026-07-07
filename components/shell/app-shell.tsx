"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  Database,
  CalendarPlus,
  CalendarRange,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LogOut,
  type LucideIcon,
  Menu,
  MoreVertical,
  Search,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { MigrationBanner } from "@/components/admin/migration-banner";
import { FeedbackWidget } from "@/components/candidate/feedback-widget";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UpdateBanner } from "@/components/shell/update-banner";
import { UpcomingBanner } from "@/components/upcoming-banner";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";

type BadgeKey = "pending" | "unpaid" | "unread";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: BadgeKey;
  tone?: "amber" | "red" | "purple";
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
      { label: "Requests", href: "/admin/requests", icon: Inbox, badge: "pending", tone: "amber" },
      { label: "Interviews", href: "/admin/interviews", icon: CalendarRange },
      { label: "Calendar", href: "/admin/calendar", icon: CalendarDays },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Candidates", href: "/admin/candidates", icon: Users },
      { label: "Interviewers", href: "/admin/interviewers", icon: UserCog },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Payments", href: "/admin/payments", icon: CreditCard, badge: "unpaid", tone: "red" },
      { label: "Revenue", href: "/admin/revenue", icon: Wallet },
      { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Notifications", href: "/admin/notifications", icon: Bell, badge: "unread", tone: "purple" },
      { label: "Activity", href: "/admin/activity", icon: Activity },
      { label: "Storage", href: "/admin/storage", icon: Database },
      { label: "Booking Links", href: "/admin/booking-links", icon: Link2 },
      { label: "Feedback", href: "/admin/feedback", icon: Inbox },
      { label: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

const CANDIDATE_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "My Dashboard", href: "/candidate/dashboard", icon: LayoutDashboard },
      { label: "My Interviews", href: "/candidate/interviews", icon: CalendarRange },
      { label: "Book Interview", href: "/candidate/book", icon: CalendarPlus },
      { label: "Calendar", href: "/candidate/calendar", icon: CalendarDays },
      { label: "Payments", href: "/candidate/payments", icon: Wallet },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/candidate/settings", icon: User },
      { label: "Notifications", href: "/candidate/notifications", icon: Bell, badge: "unread", tone: "purple" },
      { label: "Support", href: "/candidate/support", icon: LifeBuoy },
    ],
  },
];

const BADGE_TONE: Record<string, string> = {
  amber: "bg-[#f59e0b]/15 text-[#fbbf24]",
  red: "bg-[#ef4444]/15 text-[#f87171]",
  purple: "bg-[#8b5cf6]/15 text-[#c4b5fd]",
};

export interface ShellProps {
  variant: "admin" | "candidate";
  user: { name: string; email: string };
  userId: string;
  isAdmin?: boolean;
  counts: { pending: number; unpaid: number; unread: number };
  children: React.ReactNode;
}

export function AppShell({ variant, user, userId, isAdmin = false, counts, children }: ShellProps) {
  const pathname = usePathname();
  // Calendar/booking views get a wider container so the week grid can breathe on
  // large screens (other pages stay comfortably readable at max-w-6xl).
  const wide = /\/calendar(\/|$)|\/book(\/|$)/.test(pathname ?? "");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nav = variant === "admin" ? ADMIN_NAV : CANDIDATE_NAV;
  const width = variant === "admin" ? "lg:w-[220px]" : "lg:w-[200px]";
  const pad = variant === "admin" ? "lg:pl-[220px]" : "lg:pl-[200px]";
  const roleLabel = variant === "admin" ? "Admin" : "Candidate";
  const notifHref = variant === "admin" ? "/admin/notifications" : "/candidate/notifications";
  const breadcrumb = prettySegment(pathname);

  const sidebar = (
    <SidebarContent
      nav={nav}
      counts={counts}
      pathname={pathname}
      user={user}
      roleLabel={roleLabel}
      variant={variant}
      isAdmin={isAdmin}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="min-h-screen bg-[#0f0f13]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.06] bg-[#0d0d12] lg:flex",
          width,
        )}
      >
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[240px] flex-col border-r border-white/[0.06] bg-[#0d0d12]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-md p-1 text-white/40 hover:bg-white/[0.06]"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className={pad}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-white/[0.06] bg-[#0f0f13]/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-white/50 hover:bg-white/[0.06] lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>

          <nav className="hidden items-center gap-1 text-[12px] sm:flex">
            <span className="text-white/30">Home</span>
            <ChevronRight className="h-3.5 w-3.5 text-white/20" />
            <span className="font-medium text-[#f0f0f5]">{breadcrumb}</span>
          </nav>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-lg border border-white/[0.06] bg-[#13131a] px-3 py-1.5 text-white/30 transition-colors hover:border-white/15 hover:text-white/50 md:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="text-[12px]">
              {variant === "admin" ? "Search candidates, requests…" : "Search your interviews…"}
            </span>
            <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="rounded-md p-1.5 text-white/50 hover:bg-white/[0.06] hover:text-white/80 md:hidden"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            <NotificationBell userId={userId} notifHref={notifHref} />
            <span className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
              {initials(user.name, user.email)}
            </span>
          </div>
        </header>

        <UpdateBanner />

        <main className={cn("mx-auto px-4 py-6 sm:px-6 sm:py-8", wide ? "max-w-none" : "max-w-6xl")}>
          {variant === "admin" ? <MigrationBanner /> : null}
          <UpcomingBanner userId={userId} />
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} variant={variant} userId={userId} />
      {variant === "candidate" ? <FeedbackWidget userId={userId} name={user.name} email={user.email} /> : null}
    </div>
  );
}

function SidebarContent({
  nav,
  counts,
  pathname,
  user,
  roleLabel,
  variant,
  isAdmin,
  onNavigate,
}: {
  nav: NavGroup[];
  counts: { pending: number; unpaid: number; unread: number };
  pathname: string;
  user: { name: string; email: string };
  roleLabel: string;
  variant: "admin" | "candidate";
  isAdmin: boolean;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white">
          <CalendarDays className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-medium text-[#f0f0f5]">Interview Pro</span>
        <span className="ml-1 rounded bg-[#6366f1]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#a5b4fc]">
          {roleLabel}
        </span>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2">
        {nav.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/25">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              const count = item.badge ? counts[item.badge] : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-1.5 text-[13px] transition-colors",
                    active
                      ? "border-[#6366f1] bg-[#6366f1]/[0.08] text-[#f0f0f5]"
                      : "border-transparent text-white/55 hover:bg-white/[0.05] hover:text-white/80",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.badge && count > 0 ? (
                    <span
                      className={cn(
                        "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                        BADGE_TONE[item.tone ?? "purple"],
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <UserMenu user={user} roleLabel={roleLabel} variant={variant} canSwitch={isAdmin} />
    </>
  );
}

function UserMenu({
  user,
  roleLabel,
  variant,
  canSwitch,
}: {
  user: { name: string; email: string };
  roleLabel: string;
  variant: "admin" | "candidate";
  canSwitch: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const onAdminSide = variant === "admin";

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative border-t border-white/[0.06] p-2">
      {open ? (
        <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#13131a] py-1 shadow-xl shadow-black/40">
          {canSwitch ? (
            <Link
              href={onAdminSide ? "/candidate/dashboard" : "/admin/dashboard"}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-[#a5b4fc] hover:bg-white/[0.05] hover:text-[#c7d2fe]"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {onAdminSide ? "Switch to candidate view" : "Switch to admin view"}
            </Link>
          ) : null}
          <Link
            href={onAdminSide ? "/admin/settings" : "/candidate/settings"}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-white/60 hover:bg-white/[0.05] hover:text-white/90"
          >
            <User className="h-3.5 w-3.5" /> Profile
          </Link>
          <Link
            href={onAdminSide ? "/admin/settings" : "/candidate/settings"}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-white/60 hover:bg-white/[0.05] hover:text-white/90"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[#f87171] hover:bg-white/[0.05]"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[0.05]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-semibold text-white">
          {initials(user.name, user.email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[#f0f0f5]">
            {user.name || user.email}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-[#a5b4fc]">
            <ShieldCheck className="h-3 w-3" />
            {onAdminSide ? "Super Admin" : "Candidate"}
          </span>
        </span>
        <MoreVertical className="h-4 w-4 shrink-0 text-white/30" />
      </button>
    </div>
  );
}

function prettySegment(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean).pop() ?? "";
  if (!seg) return "Home";
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
