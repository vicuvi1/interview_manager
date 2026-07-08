import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Info, Receipt, XCircle } from "lucide-react";

import type { Tone } from "@/components/ui/badge";

/** Visual treatment per notification `type`. */
export const NOTIFICATION_META: Record<
  string,
  { icon: LucideIcon; tone: Tone; iconClass: string; label: string }
> = {
  success: { icon: CheckCircle2, tone: "green", iconClass: "text-[#34d399]", label: "Success" },
  approved: { icon: CalendarCheck, tone: "indigo", iconClass: "text-[#a5b4fc]", label: "Scheduling" },
  rejected: { icon: XCircle, tone: "red", iconClass: "text-[#f87171]", label: "Declined" },
  alert: { icon: AlertTriangle, tone: "amber", iconClass: "text-[#fbbf24]", label: "Alert" },
  invoice: { icon: Receipt, tone: "amber", iconClass: "text-[#fbbf24]", label: "Invoice" },
  info: { icon: Info, tone: "slate", iconClass: "text-white/50", label: "Info" },
};

export function notifMeta(type: string) {
  return NOTIFICATION_META[type] ?? NOTIFICATION_META.info;
}

export function notifTypeLabel(type: string) {
  return NOTIFICATION_META[type]?.label ?? "Info";
}
