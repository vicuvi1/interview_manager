/** Option lists for the interview request form + labels for display. */

export const INTERVIEW_TYPES = [
  "Screening",
  "Phone screen",
  "Technical",
  "Coding",
  "Live coding",
  "System design",
  "Take-home review",
  "Panel",
  "Behavioral",
  "HR / Recruiter screen",
  "Case study",
  "Mock interview",
  "Final round",
  "Other",
];

export const LEVELS = [
  "Internship",
  "Junior",
  "Mid-level",
  "Senior",
  "Staff",
  "Lead",
  "Manager",
  "Not sure",
];

export const FORMATS = [
  { value: "video", label: "Video call" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
] as const;

export const FORMAT_LABEL: Record<string, string> = {
  video: "Video call",
  phone: "Phone",
  in_person: "In person",
};

/** An emoji + color shown for an interview type on badges and the calendar. */
export interface TypeStyle {
  emoji: string;
  color: string;
}
export type TypeStyleMap = Record<string, TypeStyle>;

/** Sensible defaults per interview type. Admins can override these in Settings. */
export const INTERVIEW_TYPE_STYLES: TypeStyleMap = {
  Screening: { emoji: "🔍", color: "#3b82f6" },
  "Phone screen": { emoji: "📞", color: "#ef4444" },
  Technical: { emoji: "💻", color: "#6366f1" },
  Coding: { emoji: "⌨️", color: "#8b5cf6" },
  "Live coding": { emoji: "🖥️", color: "#8b5cf6" },
  "System design": { emoji: "🧩", color: "#14b8a6" },
  "Take-home review": { emoji: "📝", color: "#f59e0b" },
  Panel: { emoji: "👥", color: "#3b82f6" },
  Behavioral: { emoji: "💬", color: "#ec4899" },
  "HR / Recruiter screen": { emoji: "🧑‍💼", color: "#10b981" },
  "Case study": { emoji: "📊", color: "#f59e0b" },
  "Mock interview": { emoji: "🎭", color: "#14b8a6" },
  "Final round": { emoji: "🏁", color: "#10b981" },
  Other: { emoji: "📌", color: "#6366f1" },
};

export const DEFAULT_TYPE_STYLE: TypeStyle = { emoji: "📅", color: "#6366f1" };

/** Resolve a type's style: admin override → built-in default → generic fallback. */
export function typeStyle(type: string | null | undefined, overrides?: TypeStyleMap | null): TypeStyle {
  if (!type) return DEFAULT_TYPE_STYLE;
  return overrides?.[type] ?? INTERVIEW_TYPE_STYLES[type] ?? DEFAULT_TYPE_STYLE;
}

/** All type keys to show in the editor: the known list plus any saved custom ones. */
export function allTypeKeys(overrides?: TypeStyleMap | null): string[] {
  const keys = [...INTERVIEW_TYPES];
  if (overrides) for (const k of Object.keys(overrides)) if (!keys.includes(k)) keys.push(k);
  return keys;
}
