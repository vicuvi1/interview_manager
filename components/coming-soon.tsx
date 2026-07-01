import type { LucideIcon } from "lucide-react";
import { Hammer } from "lucide-react";

import { SectionCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function ComingSoon({
  title,
  description = "This section is coming in a later phase.",
  icon = Hammer,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div>
      <h1 className="mb-4 text-xl font-medium text-[#f0f0f5]">{title}</h1>
      <SectionCard title={title} description="Under construction" icon={icon}>
        <EmptyState icon={icon} title="Coming soon" description={description} />
      </SectionCard>
    </div>
  );
}
