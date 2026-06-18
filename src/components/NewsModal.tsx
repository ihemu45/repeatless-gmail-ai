"use client";

import { useEffect, useState } from "react";
import type { NewsClusterDTO } from "@/lib/types";
import { api } from "@/lib/client";
import { Spinner } from "./ui";

export default function NewsModal({
  onClose,
  onOpenThread,
}: {
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [days, setDays] = useState(4);
  const [clusters, setClusters] = useState<NewsClusterDTO[]>([]);
  const [meta, setMeta] = useState<{ itemCount: number; newsletterCount: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.news(days);
        if (cancelled) return;
        setClusters(res.clusters);
        setMeta({ itemCount: res.itemCount, newsletterCount: res.newsletterCount });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const dedupSaved = meta ? meta.itemCount - clusters.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="animate-rise flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="font-semibold">📰 News digest</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-2 text-sm">
          <span className="text-gray-600">Past</span>
          {[2, 4, 7, 14].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={
                "rounded-full px-3 py-1 text-xs " +
                (days === d ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700")
              }
            >
              {d} days
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 scroll-thin">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="text-gray-400" /> Reading newsletters and deduplicating…
            </div>
          )}
          {error && <div className="text-sm text-rose-600">{error}</div>}

          {!loading && !error && (
            <>
              {meta && (
                <p className="mb-4 text-xs text-[var(--muted)]">
                  {meta.newsletterCount} newsletters · {meta.itemCount} items →{" "}
                  <span className="font-medium text-gray-700">
                    {clusters.length} unique stories
                  </span>
                  {dedupSaved > 0 && ` (${dedupSaved} duplicates merged)`}
                </p>
              )}
              {clusters.length === 0 && (
                <p className="text-sm text-[var(--muted)]">
                  No newsletter stories found in this window. Sync more mail, or widen the
                  range.
                </p>
              )}
              <div className="space-y-3">
                {clusters.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[var(--border)] p-4"
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{c.title}</h3>
                      {c.count > 1 && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          {c.count} sources
                        </span>
                      )}
                    </div>
                    {c.summary && (
                      <p className="mb-2 text-sm text-gray-600">{c.summary}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {c.sources.map((s) => (
                        <button
                          key={s.messageId}
                          onClick={() => {
                            onOpenThread(s.threadId);
                            onClose();
                          }}
                          className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-brand-100 hover:text-brand-700"
                        >
                          {s.source}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
