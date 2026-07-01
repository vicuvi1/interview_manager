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
  created_at: string;
}

export interface InterviewRequest {
  id: string;
  candidate_id: string;
  role: string;
  preferred_at: string | null;
  scheduled_at: string | null;
  meeting_link: string | null;
  duration_minutes: number;
  notes: string | null;
  status: InterviewStatus;
  payment_status: PaymentStatus;
  price_cents: number | null;
  currency: string;
  paid_at: string | null;
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

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  detail: string | null;
  type: string;
  read: boolean;
  created_at: string;
}
