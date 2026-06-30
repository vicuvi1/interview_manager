import { ShieldAlert } from "lucide-react";

import { Topbar } from "@/components/topbar";
import { SectionCard } from "@/components/ui/card";

export function AccessRequired({ email }: { email: string }) {
  return (
    <div className="min-h-screen">
      <Topbar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <SectionCard
          title="Admin access required"
          description="Your account isn't an admin yet."
          icon={ShieldAlert}
        >
          <p className="text-sm text-slate-600">
            Grant yourself the admin role by running this in the Supabase SQL editor,
            then reload this page:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[13px] leading-relaxed text-slate-100">
            {`update public.profiles\nset role = 'admin'\nwhere email = '${email || "you@example.com"}';`}
          </pre>
        </SectionCard>
      </main>
    </div>
  );
}
