export type InterviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "scheduled"
  | "completed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid";

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string;
  role: string;
  blocked?: boolean;
  stage?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
  resume_url?: string | null;
  resume_path?: string | null;
  bio?: string | null;
  tags?: string[] | null;
  created_at: string;
}

export interface InterviewTemplate {
  id: string;
  name: string;
  role: string | null;
  interview_type: string | null;
  level: string | null;
  duration_minutes: number;
  format: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** The reusable materials a candidate keeps on their profile. */
export interface CandidateMaterials {
  phone: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  resume_url: string | null;
  resume_path?: string | null;
  /** A short-lived signed URL for an uploaded résumé (generated server-side for admins). */
  resume_signed_url?: string | null;
  bio: string | null;
}

export interface InterviewRequest {
  id: string;
  candidate_id: string;
  role: string;
  interviewer_id: string | null;
  interview_type?: string | null;
  level?: string | null;
  focus_areas?: string[] | null;
  format?: string | null;
  goals?: string | null;
  caller_notes?: string | null;
  job_desc_url?: string | null;
  job_desc_path?: string | null;
  preferred_at: string | null;
  scheduled_at: string | null;
  proposed_at?: string | null;
  meeting_link: string | null;
  duration_minutes: number;
  notes: string | null;
  status: InterviewStatus;
  payment_status: PaymentStatus;
  price_cents: number | null;
  currency: string;
  paid_at: string | null;
  payment_reported_at?: string | null;
  payment_hidden?: boolean;
  color?: string | null;
  created_at: string;
}

export interface CandidateLite {
  full_name: string | null;
  email: string | null;
  timezone: string;
}

export interface ProfileLite {
  id: string;
  full_name: string | null;
  email: string | null;
  timezone: string;
  role: string;
  blocked?: boolean;
  stage?: string | null;
  tags?: string[] | null;
  created_at: string;
}

export interface Payment {
  id: string;
  interview_id: string | null;
  candidate_id: string;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  paid_at: string | null;
  notes: string | null;
  receipt_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilitySlot {
  id: string;
  title: string | null;
  slot_type: string; // "available" | "busy" | "event"
  starts_at: string;
  ends_at: string;
  repeat_rule: string; // "none" | "daily" | "weekly"
  is_booked: boolean;
  candidate_id: string | null;
  meeting_link: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InterviewFeedback {
  id: string;
  interview_id: string;
  author_id: string | null;
  outcome: string; // advance | hold | reject | no_show
  rating: number | null;
  strengths: string | null;
  concerns: string | null;
  shared_feedback: string | null;
  action_items: string | null;
  action_items_done?: number[] | null;
  actual_minutes: number | null;
  shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface InterviewPricing {
  interview_type: string;
  price_cents: number;
  currency: string;
  updated_at?: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
}

export interface CandidateNote {
  id: string;
  candidate_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface PaymentWallet {
  id: string;
  asset: string;
  network: string | null;
  address: string;
  memo: string | null;
  active: boolean;
  sort: number;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  detail: string | null;
  type: string;
  read: boolean;
  created_at: string;
}
