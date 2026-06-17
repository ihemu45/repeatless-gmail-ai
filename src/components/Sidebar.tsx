"use client";

import { EMAIL_CATEGORIES, CATEGORY_LABELS } from "@/lib/types";
import { CATEGORY_STYLE, Spinner, cx } from "./ui";
import type { MeResponse } from "@/lib/client";

interface SidebarProps {
  email: string;
  counts: Record<string, number>;
  activeCategory: string;
  onSelectCategory: (c: string) => void;
  sync: MeResponse["sync"];
  syncing: boolean;
  syncMessage: string;
  onSync: () => void;
  onCompose: () => void;
  onToggleChat: () => void;
  onOpenNews: () => void;
  chatOpen: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const rows: Array<{ key: string; label: string; dot?: string; icon?: string }> = [
    { key: "all", label: "All mail", icon: "📥" },
    ...EMAIL_CATEGORIES.map((c) => ({
      key: c,
      label: CATEGORY_LABELS[c],
      dot: CATEGORY_STYLE[c].dot,
      icon: CATEGORY_STYLE[c].icon,
    })),
  ];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm">
          📬
        </div>
        <span className="font-semibold">Repeatless Mail</span>
      </div>

      <div className="px-3">
        <button
          onClick={props.onCompose}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          ✏️ Compose
        </button>
        <button
          onClick={props.onToggleChat}
          className={cx(
            "mb-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
            props.chatOpen
              ? "bg-brand-100 text-brand-700"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200",
          )}
        >
          ✨ Ask AI
        </button>
        <button
          onClick={props.onOpenNews}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
        >
          📰 News digest
        </button>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 scroll-thin">
        {rows.map((r) => {
          const active = props.activeCategory === r.key;
          const count = props.counts[r.key];
          return (
            <button
              key={r.key}
              onClick={() => props.onSelectCategory(r.key)}
              className={cx(
                "mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-brand-50 font-medium text-brand-700" : "text-gray-700 hover:bg-gray-50",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="w-4 text-center">{r.icon}</span>
                {r.label}
              </span>
              {typeof count === "number" && count > 0 && (
                <span className="text-xs text-[var(--muted)]">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sync status */}
      <div className="border-t border-[var(--border)] p-3">
        <button
          onClick={props.onSync}
          disabled={props.syncing}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
        >
          {props.syncing ? <Spinner className="text-gray-500" /> : "🔄"}
          {props.syncing ? "Syncing…" : "Sync inbox"}
        </button>
        {props.syncMessage && (
          <p className="mt-2 text-center text-[11px] leading-tight text-[var(--muted)]">
            {props.syncMessage}
          </p>
        )}
        {props.sync?.last_error && !props.syncing && (
          <p className="mt-1 text-center text-[11px] text-rose-600">
            {props.sync.last_error}
          </p>
        )}
      </div>

      {/* Account */}
      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
        <span className="truncate text-xs text-[var(--muted)]" title={props.email}>
          {props.email}
        </span>
        <a
          href="/api/auth/logout"
          className="ml-2 shrink-0 text-xs text-gray-500 underline hover:text-gray-800"
        >
          Sign out
        </a>
      </div>
    </aside>
  );
}
