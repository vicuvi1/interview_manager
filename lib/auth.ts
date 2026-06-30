import { ADMIN_EMAIL } from "@/lib/constants";
import type { Profile } from "@/lib/types";

/** Admin if their profile role is 'admin' OR they use the designated email. */
export function isAdminUser(
  profile: Profile | null,
  email: string | null | undefined,
): boolean {
  if (profile?.role === "admin") return true;
  return !!email && email.toLowerCase() === ADMIN_EMAIL;
}
