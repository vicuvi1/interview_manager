import { redirect } from "next/navigation";

import { AccessRequired } from "@/components/admin/access-required";
import { AppShell } from "@/components/shell/app-shell";
import { isAdminUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  const me = meRow as Profile | null;

  if (!isAdminUser(me, user.email)) {
    return <AccessRequired email={user.email ?? ""} />;
  }

  const [pendingRes, unpaidRes, unreadRes] = await Promise.all([
    supabase
      .from("interview_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("interview_requests")
      .select("*", { count: "exact", head: true })
      .eq("payment_status", "unpaid")
      .not("price_cents", "is", null),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false),
  ]);

  return (
    <AppShell
      variant="admin"
      user={{ name: me?.full_name ?? "", email: user.email ?? "" }}
      userId={user.id}
      counts={{
        pending: pendingRes.count ?? 0,
        unpaid: unpaidRes.count ?? 0,
        unread: unreadRes.count ?? 0,
      }}
    >
      {children}
    </AppShell>
  );
}
