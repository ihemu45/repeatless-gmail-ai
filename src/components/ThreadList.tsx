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
    <div className="flex w-[380px] shrink-0 flex-col border-r border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{props.title}</h2>
          {props.loading && <Spinner className="text-gray-400" />}
        </div>
        <input
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          placeholder="Search subjects…"
          className="w-full rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white"
        />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
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
                "flex w-full flex-col gap-1 border-b border-[var(--border)] px-4 py-3 text-left transition",
                selected ? "bg-brand-50" : "hover:bg-gray-50",
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
