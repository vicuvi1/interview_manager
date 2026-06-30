import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and resolve Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Initials for an avatar, from a name (falling back to an email). */
export function initials(name?: string | null, email?: string | null) {
  const source = (name && name.trim()) || (email ? email.split("@")[0] : "");
  if (!source) return "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return letters.toUpperCase() || source[0].toUpperCase();
}
