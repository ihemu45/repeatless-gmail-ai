"use client";

import type { EmailCategory } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Colour + emoji per category, used in the sidebar and on thread rows. */
export const CATEGORY_STYLE: Record<
  EmailCategory,
  { dot: string; chip: string; icon: string }
> = {
  newsletters: { dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700", icon: "📰" },
  job: { dot: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700", icon: "💼" },
  finance: { dot: "bg-sky-400", chip: "bg-sky-50 text-sky-700", icon: "💳" },
  notifications: { dot: "bg-violet-400", chip: "bg-violet-50 text-violet-700", icon: "🔔" },
  personal: { dot: "bg-rose-400", chip: "bg-rose-50 text-rose-700", icon: "👤" },
  work: { dot: "bg-indigo-400", chip: "bg-indigo-50 text-indigo-700", icon: "🗂️" },
  other: { dot: "bg-gray-300", chip: "bg-gray-100 text-gray-600", icon: "✉️" },
};

export function CategoryChip({ category }: { category: EmailCategory | null }) {
  if (!category) return null;
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        style.chip,
      )}
    >
      <span>{style.icon}</span>
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx("animate-spin", className)}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** Deterministic vibrant gradient per sender, for colorful avatars. */
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#6366f1,#8b5cf6)",
  "linear-gradient(135deg,#ec4899,#f43f5e)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#10b981,#14b8a6)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#8b5cf6,#d946ef)",
  "linear-gradient(135deg,#0ea5e9,#6366f1)",
  "linear-gradient(135deg,#f97316,#f59e0b)",
];

export function avatarGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
