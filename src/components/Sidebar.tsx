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
    <aside className="surface flex w-64 shrink-0 flex-col border-r border-[var(--border)]">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-sm shadow-[0_6px_16px_-8px_rgba(79,70,229,.7)]">
          📬
        </div>
        <span className="font-semibold tracking-tight">Repeatless Mail</span>
      </div>

      <div className="px-3">
        <button
          onClick={props.onCompose}
          className="btn-primary mb-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          ✏️ Compose
        </button>
        <button
          onClick={props.onToggleChat}
          className={cx(
            "mb-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
            props.chatOpen
              ? "bg-brand-100 text-brand-700 ring-1 ring-brand-200"
              : "btn-soft text-gray-700",
          )}
        >
          ✨ Ask AI
        </button>
        <button
          onClick={props.onOpenNews}
          className="btn-soft flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700"
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
                "lift mb-0.5 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm",
                active
                  ? "bg-gradient-to-r from-brand-50 to-violet-50 font-semibold text-brand-700 ring-1 ring-brand-100"
                  : "text-gray-700 hover:bg-white/70",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="w-4 text-center">{r.icon}</span>
                {r.label}
              </span>
              {typeof count === "number" && count > 0 && (
                <span
                  className={cx(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    active ? "bg-white/70 text-brand-700" : "text-[var(--muted)]",
                  )}
                >
                  {count}
                </span>
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
          className="btn-soft flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-60"
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
