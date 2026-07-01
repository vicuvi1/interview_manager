import { redirect } from "next/navigation";

import { StorageBoard } from "@/components/admin/storage-board";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <StorageBoard />;
}
