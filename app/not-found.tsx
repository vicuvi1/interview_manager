import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f0f13] px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-white">
        <Compass className="h-7 w-7" />
      </span>
      <h1 className="mt-5 text-3xl font-semibold text-[#f0f0f5]">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-white/45">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/candidate/dashboard"
        className="mt-6 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
