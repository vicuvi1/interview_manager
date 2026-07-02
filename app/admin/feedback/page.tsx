import { redirect } from "next/navigation";

import { FeedbackInbox } from "@/components/admin/feedback-inbox";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = { title: "Feedback" };

export default async function AdminFeedbackPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("app_feedback").select("*").order("created_at", { ascending: false });

  return <FeedbackInbox initial={(data as never[]) ?? []} />;
}
