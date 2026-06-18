"use client";

import type { EmailCategory } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Soft, warm per-category palette: chip background/foreground + a dot colour
 * used in the sidebar nav. Matches the warm editorial design. */
export const CATEGORY_STYLE: Record<
  EmailCategory,
  { chipBg: string; chipFg: string; dot: string }
> = {
  newsletters: { chipBg: "#E9F0FA", chipFg: "#2D5896", dot: "#3C76C9" },
  job: { chipBg: "#F3E9F6", chipFg: "#7E3E94", dot: "#8A52A8" },
  finance: { chipBg: "#E7F2EC", chipFg: "#2C6B4A", dot: "#3B8C63" },
  notifications: { chipBg: "#FBEEDD", chipFg: "#9A6112", dot: "#E0892B" },
  personal: { chipBg: "#FBEAEA", chipFg: "#A23F3A", dot: "#C5544A" },
  work: { chipBg: "#E6F4F4", chipFg: "#1E6E6E", dot: "#1E9E9E" },
  other: { chipBg: "#F0EDE7", chipFg: "#6B6258", dot: "#A8A096" },
};

export function CategoryChip({ category }: { category: EmailCategory | null }) {
  if (!category) return null;
  const style = CATEGORY_STYLE[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ background: style.chipBg, color: style.chipFg }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: style.chipFg }}
      />
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

/** Deterministic muted solid colour per sender, for tasteful avatars. */
const AVATAR_COLORS = [
  "#3B8C63",
  "#E0892B",
  "#3C76C9",
  "#C5544A",
  "#1E9E9E",
  "#8A52A8",
  "#B5824A",
  "#5B6CC0",
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
