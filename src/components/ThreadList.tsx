"use client";

import type { ThreadRow } from "@/lib/types";
import { CategoryChip, Spinner, cx, relativeTime } from "./ui";

interface ThreadListProps {
  threads: ThreadRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  loading: boolean;
  title: string;
}

export default function ThreadList(props: ThreadListProps) {
  return (
    <div className="surface flex w-[380px] shrink-0 flex-col border-r border-[var(--border)]">
      <div className="border-b border-[var(--border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">{props.title}</h2>
          {props.loading && <Spinner className="text-gray-400" />}
        </div>
        <input
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          placeholder="Search subjects…"
          className="w-full rounded-xl border border-[var(--border-strong)] bg-white/70 px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2 scroll-thin">
        {props.threads.length === 0 && !props.loading && (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No conversations here yet.
            <br />
            Try syncing your inbox.
          </div>
        )}

        {props.threads.map((t) => {
          const selected = props.selectedId === t.id;
          const lead = t.participants?.[0];
          const who = lead?.name || lead?.email || "Unknown";
          return (
            <button
              key={t.id}
              onClick={() => props.onSelect(t.id)}
              className={cx(
                "lift flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left",
                selected
                  ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,.05),0_10px_24px_-16px_rgba(16,24,40,.25)] ring-1 ring-brand-100"
                  : "hover:bg-white/70",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{who}</span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  {relativeTime(t.last_message_at)}
                </span>
              </div>
              <span className="truncate text-sm text-gray-800">
                {t.subject || "(no subject)"}
                {t.message_count > 1 && (
                  <span className="ml-1 text-xs text-[var(--muted)]">
                    ({t.message_count})
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-xs text-[var(--muted)]">
                {t.summary || t.snippet}
              </span>
              <div className="mt-0.5">
                <CategoryChip category={t.category} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
