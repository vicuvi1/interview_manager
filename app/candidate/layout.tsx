import { redirect } from "next/navigation";

import { AccountSuspended } from "@/components/account-suspended";
import { AppShell } from "@/components/shell/app-shell";
import { isAdminUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meRow } = await supabase
    .from("profiles")
    .select("full_name, blocked, role")
    .eq("id", user.id)
    .maybeSingle();
  const me = meRow as { full_name?: string; blocked?: boolean; role?: string } | null;
  if (me?.blocked) {
    return <AccountSuspended email={user.email ?? ""} />;
  }
  const name = me?.full_name ?? "";
  const isAdmin = isAdminUser({ role: me?.role } as Profile, user.email);

  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);

  return (
    <AppShell
      variant="candidate"
      user={{ name, email: user.email ?? "" }}
      userId={user.id}
      isAdmin={isAdmin}
      counts={{ pending: 0, unpaid: 0, unread: count ?? 0 }}
    >
      {children}
    </AppShell>
  );
}
