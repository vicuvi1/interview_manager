import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meRow } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const name = (meRow as { full_name?: string } | null)?.full_name ?? "";

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
      counts={{ pending: 0, unpaid: 0, unread: count ?? 0 }}
    >
      {children}
    </AppShell>
  );
}
