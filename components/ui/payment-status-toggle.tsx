"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface PaymentStatusToggleProps {
  interviewId: string;
  currentStatus: "paid" | "unpaid";
  onStatusChange?: (newStatus: "paid" | "unpaid") => void;
  className?: string;
}

export function PaymentStatusToggle({
  interviewId,
  currentStatus,
  onStatusChange,
  className,
}: PaymentStatusToggleProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const isPaid = currentStatus === "paid";

  async function togglePaymentStatus() {
    setLoading(true);
    const newStatus = isPaid ? "unpaid" : "paid";
    const supabase = createClient();

    const { error } = await supabase
      .from("interview_requests")
      .update({ payment_status: newStatus })
      .eq("id", interviewId);

    if (error) {
      toast({
        title: "Failed to update payment status",
        description: error.message,
        variant: "error",
      });
      setLoading(false);
      return;
    }

    toast({
      title: `Marked as ${newStatus}`,
      description: `Interview status updated to ${newStatus}.`,
      variant: "success",
    });

    onStatusChange?.(newStatus);
    setLoading(false);
  }

  return (
    <button
      onClick={togglePaymentStatus}
      disabled={loading}
      title={`Click to mark as ${isPaid ? "unpaid" : "paid"}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all hover:shadow-md",
        isPaid
          ? "bg-green-500/15 text-green-300 ring-1 ring-green-500/30 hover:bg-green-500/25"
          : "bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25",
        loading && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {isPaid ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Paid
        </>
      ) : (
        <>
          <X className="h-3.5 w-3.5" />
          Unpaid
        </>
      )}
    </button>
  );
}
