import { redirect } from "next/navigation";
import { Hammer, ShieldCheck } from "lucide-react";

import { Topbar } from "@/components/topbar";
import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/dashboard");

  return (
    <div className="min-h-screen">
      <Topbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <SectionCard
          title="Admin workspace"
          description="Approvals, scheduling, and payments land here in a later phase."
          icon={ShieldCheck}
        >
          <EmptyState
            icon={Hammer}
            title="Under construction"
            description="This phase ships the candidate dashboard only."
          />
        </SectionCard>
      </main>
    </div>
  );
}
