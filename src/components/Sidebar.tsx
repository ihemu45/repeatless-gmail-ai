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
  const rows: Array<{ key: string; label: string; dot: string }> = [
    { key: "all", label: "All mail", dot: "var(--accent)" },
    ...EMAIL_CATEGORIES.map((c) => ({
      key: c,
      label: CATEGORY_LABELS[c],
      dot: CATEGORY_STYLE[c].dot,
    })),
  ];

  return (
    <aside className="surface flex w-64 shrink-0 flex-col border-r border-[var(--line)]">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-[0_4px_10px_rgba(67,56,202,.28)]">
          <span className="font-display text-lg font-semibold leading-none">R</span>
        </div>
        <span className="font-display text-[17px] font-semibold leading-tight text-[var(--ink)]">
          Repeatless Mail
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3">
        <button
          onClick={props.onCompose}
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
        >
          ✏️ Compose
        </button>
        <button
          onClick={props.onToggleChat}
          className={cx(
            "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
            props.chatOpen
              ? "bg-[var(--accent-soft)] text-[var(--accent-deep)]"
              : "btn-soft text-[var(--ink-2)]",
          )}
        >
          ✨ Ask AI
        </button>
        <button
          onClick={props.onOpenNews}
          className="btn-soft flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--ink-2)]"
        >
          📰 News digest
        </button>
      </div>

      <div className="mt-5 px-5 pb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">
        Categories
      </div>
      <nav className="flex-1 overflow-y-auto px-3 scroll-thin">
        {rows.map((r) => {
          const active = props.activeCategory === r.key;
          const count = props.counts[r.key];
          return (
            <button
              key={r.key}
              onClick={() => props.onSelectCategory(r.key)}
              className={cx(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition",
                active
                  ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-deep)]"
                  : "font-medium text-[var(--ink-2)] hover:bg-[#f2ece2]",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: r.dot }}
              />
              <span className="flex-1 truncate text-left">{r.label}</span>
              {typeof count === "number" && count > 0 && (
                <span
                  className={cx(
                    "text-[11.5px] font-semibold tabular-nums",
                    active ? "text-[var(--accent)]" : "text-[var(--ink-4)]",
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
      <div className="border-t border-[var(--line)] p-3">
        <button
          onClick={props.onSync}
          disabled={props.syncing}
          className="btn-soft flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--ink-2)] disabled:opacity-60"
        >
          {props.syncing ? <Spinner className="text-[var(--ink-3)]" /> : "🔄"}
          {props.syncing ? "Syncing…" : "Sync inbox"}
        </button>
        {props.syncMessage && (
          <p className="mt-2 text-center text-[11px] leading-tight text-[var(--ink-4)]">
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
      <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3">
        <span className="truncate text-xs text-[var(--ink-3)]" title={props.email}>
          {props.email}
        </span>
        <a
          href="/api/auth/logout"
          className="ml-2 shrink-0 text-xs font-semibold text-[var(--accent)] hover:underline"
        >
          Sign out
        </a>
      </div>
    </aside>
  );
}
