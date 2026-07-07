/** Admin-configurable requirement level for each field on the request form. */

export type FieldLevel = "required" | "optional" | "hidden";

/** The fields an admin can configure (order = display order in settings). */
export const REQUEST_FIELDS: { key: string; label: string }[] = [
  { key: "cv", label: "Résumé / CV" },
  { key: "role", label: "Role / topic" },
  { key: "company", label: "Company name" },
  { key: "interview_type", label: "Interview type / stage" },
  { key: "level", label: "Level" },
  { key: "focus", label: "Focus areas / skills" },
  { key: "format", label: "Format" },
  { key: "job_desc", label: "Job description" },
  { key: "caller_notes", label: "Notes for the caller" },
  { key: "notes", label: "Anything else" },
  { key: "phone", label: "Phone" },
  { key: "portfolio", label: "Portfolio" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "github", label: "GitHub" },
];

/** Defaults when the admin hasn't set anything: CV required, everything else optional. */
export const DEFAULT_FIELD_LEVELS: Record<string, FieldLevel> = {
  cv: "required",
};

export type FieldConfig = Record<string, FieldLevel>;

/** The effective level for a field (config → default → "optional"). */
export function fieldLevel(cfg: FieldConfig | null | undefined, key: string): FieldLevel {
  const v = cfg?.[key];
  if (v === "required" || v === "optional" || v === "hidden") return v;
  return DEFAULT_FIELD_LEVELS[key] ?? "optional";
}

/** " — required" / " (optional)" suffix for a field label. */
export function levelSuffix(level: FieldLevel): string {
  return level === "required" ? " — required" : " (optional)";
}
