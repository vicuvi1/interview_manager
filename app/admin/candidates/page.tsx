import { Users } from "lucide-react";

import { ComingSoon } from "@/components/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="Candidates"
      icon={Users}
      description="Candidate directory and detail pages arrive in a later phase."
    />
  );
}
