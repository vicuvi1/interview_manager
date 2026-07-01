import { Inbox } from "lucide-react";

import { ComingSoon } from "@/components/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="Requests"
      icon={Inbox}
      description="A dedicated request-triage inbox. For now, manage requests on the Dashboard."
    />
  );
}
