import { redirect } from "next/navigation";

import { BookingLinks } from "@/components/admin/booking-links";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminBookingLinksPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <BookingLinks />;
}
