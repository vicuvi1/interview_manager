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
  duration_minutes: number;
  notes: string | null;
  status: InterviewStatus;
  payment_status: PaymentStatus;
  created_at: string;
}

export interface CandidateLite {
  full_name: string | null;
  email: string | null;
  timezone: string;
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
