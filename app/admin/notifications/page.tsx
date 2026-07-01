import { redirect } from "next/navigation";

import { NotificationsView } from "@/components/notifications/notifications-view";
import { createClient } from "@/lib/supabase/server";
import type { Notification } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  return <NotificationsView userId={user.id} initial={(data as Notification[] | null) ?? []} />;
}
