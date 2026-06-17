/** Shared domain types mirroring the Supabase schema (supabase/migrations/0001_init.sql). */

export type EmailCategory =
  | "newsletters"
  | "job"
  | "finance"
  | "notifications"
  | "personal"
  | "work"
  | "other";

export const EMAIL_CATEGORIES: EmailCategory[] = [
  "newsletters",
  "job",
  "finance",
  "notifications",
  "personal",
  "work",
  "other",
];

export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  newsletters: "Newsletters",
  job: "Job / Recruitment",
  finance: "Finance",
  notifications: "Notifications",
  personal: "Personal",
  work: "Work / Professional",
  other: "Other",
};

export interface Contact {
  name: string;
  email: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  user_id: string;
  rfc822_message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  from_name: string | null;
  from_email: string | null;
  to_recipients: Contact[];
  cc_recipients: Contact[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  label_ids: string[];
  is_unread: boolean;
  internal_date: string | null;
  category: EmailCategory | null;
  summary: string | null;
  embedded: boolean;
}

export interface ThreadRow {
  id: string;
  user_id: string;
  subject: string | null;
  snippet: string | null;
  participants: Contact[];
  message_count: number;
  last_message_at: string | null;
  category: EmailCategory | null;
  summary: string | null;
  summary_updated_at: string | null;
  summary_msg_count: number | null;
  history_id: string | null;
}

export interface ChatSource {
  message_id: string;
  thread_id: string;
  subject: string | null;
  from: string | null;
  date: string | null;
}

export interface NewsClusterDTO {
  title: string;
  summary: string;
  sources: { source: string; messageId: string; threadId: string }[];
  count: number;
}

export interface RetrievedChunk {
  id: number;
  message_id: string;
  thread_id: string;
  content: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  message_date: string | null;
  similarity: number;
}
