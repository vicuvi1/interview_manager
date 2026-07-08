"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { EditDetailsDialog, type EditableInterview } from "@/components/candidate/edit-details-dialog";
import { Button } from "@/components/ui/button";

/**
 * Client wrapper so the (server-rendered) interview detail view can offer an
 * "Edit" button that opens the full candidate editor.
 */
export function EditInterviewButton({ request, userId }: { request: EditableInterview; userId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit details
      </Button>
      {open ? <EditDetailsDialog request={request} userId={userId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
