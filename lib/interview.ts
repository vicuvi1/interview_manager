/** Option lists for the interview request form + labels for display. */

export const INTERVIEW_TYPES = [
  "Technical",
  "Coding",
  "System design",
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
