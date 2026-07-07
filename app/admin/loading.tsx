import { ListSkeleton } from "@/components/skeletons";

// Default instant fallback for admin pages that don't ship their own
// loading.tsx — makes navigation feel immediate instead of waiting on the server.
export default function Loading() {
  return <ListSkeleton />;
}
