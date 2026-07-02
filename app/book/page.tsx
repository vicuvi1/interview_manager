import Link from "next/link";

import { PublicBookingForm } from "@/components/public-booking-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Request an interview",
  description: "Request an interview — no account needed.",
};

export default function PublicBookingPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0f] px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-lg">
        <PublicBookingForm />
        <p className="mt-4 text-center text-[12px] text-white/30">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[#a5b4fc] hover:text-[#c7d2fe]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
