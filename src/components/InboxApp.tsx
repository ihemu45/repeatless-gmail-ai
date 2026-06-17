"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageRow, ThreadRow } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { api, type MeResponse } from "@/lib/client";
import Sidebar from "./Sidebar";
import ThreadList from "./ThreadList";
import ThreadView from "./ThreadView";
import ChatPanel from "./ChatPanel";
import ComposeModal from "./ComposeModal";
import NewsModal from "./NewsModal";

export default function InboxApp({ initialEmail }: { initialEmail: string }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ thread: ThreadRow; messages: MessageRow[] } | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  // Monotonic request ids so a slow earlier response can't overwrite a newer one.
  const threadsReqId = useRef(0);
  const detailReqId = useRef(0);

  // --- loaders ------------------------------------------------------------
  const loadMe = useCallback(async () => {
    try {
      const res = await api.me();
      if (!res.user) {
        // Session/cookie no longer valid — send the user back to sign in.
        window.location.href = "/";
        return;
      }
      setMe(res);
    } catch {
      // /api/auth/me returns 401 when the session has expired.
      window.location.href = "/";
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const { counts } = await api.stats();
      setCounts(counts);
    } catch {
      /* ignore */
    }
  }, []);

  const loadThreads = useCallback(async () => {
    const seq = ++threadsReqId.current;
    setThreadsLoading(true);
    try {
      const { threads } = await api.threads({
        category: activeCategory,
        q: debouncedQuery || undefined,
      });
      if (seq === threadsReqId.current) setThreads(threads);
    } catch {
      if (seq === threadsReqId.current) setThreads([]);
    } finally {
      if (seq === threadsReqId.current) setThreadsLoading(false);
    }
  }, [activeCategory, debouncedQuery]);

  const loadThread = useCallback(async (id: string) => {
    const seq = ++detailReqId.current;
    setDetailLoading(true);
    try {
      const res = await api.thread(id);
      if (seq === detailReqId.current) setDetail(res);
    } catch {
      if (seq === detailReqId.current) setDetail(null);
    } finally {
      if (seq === detailReqId.current) setDetailLoading(false);
    }
  }, []);

  // --- effects ------------------------------------------------------------
  useEffect(() => {
    loadMe();
    loadStats();
  }, [loadMe, loadStats]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (selectedId) loadThread(selectedId);
    else setDetail(null);
  }, [selectedId, loadThread]);

  // First-load hint based on sync state.
  useEffect(() => {
    if (!me?.sync) return;
    if (!me.sync.initial_sync_done) {
      setSyncMessage("Click “Sync inbox” to import your mail.");
    } else if (me.sync.total_synced) {
      // total_synced counts messages; the sidebar's per-category numbers count
      // threads — label explicitly so the two don't read as contradictory.
      setSyncMessage(`${me.sync.total_synced} messages synced.`);
    }
  }, [me]);

  // --- sync orchestration -------------------------------------------------
  const runningSync = useRef(false);
  async function runSync() {
    if (runningSync.current) return;
    runningSync.current = true;
    setSyncing(true);
    try {
      // 1) Pull email from Gmail (resumable batches).
      let guard = 0;
      let importMore = false;
      for (;;) {
        const r = await api.sync();
        importMore = r.more;
        setSyncMessage(
          r.initialSyncDone
            ? "Inbox imported. Analyzing…"
            : `Importing email… (${r.fetched} this batch)`,
        );
        await loadThreads();
        await loadStats();
        if (!r.more || ++guard > 80) break;
      }

      // 2) Enrich with AI (summaries, categories, embeddings).
      guard = 0;
      let processMore = false;
      for (;;) {
        const r = await api.process();
        processMore = r.more;
        setSyncMessage(`Analyzing with AI… (${r.remaining} remaining)`);
        await loadThreads();
        await loadStats();
        if (!r.more || ++guard > 200) break;
      }

      // Only claim "up to date" if both loops finished naturally; if a guard
      // tripped while work remained, tell the user to run sync again.
      setSyncMessage(
        importMore || processMore
          ? "Partial sync — click Sync inbox again to continue."
          : "Up to date ✓",
      );
      await Promise.all([loadMe(), loadStats(), loadThreads()]);
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      runningSync.current = false;
    }
  }

  function openThreadFromChat(threadId: string) {
    setSelectedId(threadId);
  }

  const title =
    activeCategory === "all"
      ? "All mail"
      : CATEGORY_LABELS[activeCategory as keyof typeof CATEGORY_LABELS] ?? "Mail";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        email={me?.user?.email ?? initialEmail}
        counts={counts}
        activeCategory={activeCategory}
        onSelectCategory={(c) => {
          setActiveCategory(c);
          setSelectedId(null);
        }}
        sync={me?.sync}
        syncing={syncing}
        syncMessage={syncMessage}
        onSync={runSync}
        onCompose={() => setComposeOpen(true)}
        onToggleChat={() => setChatOpen((v) => !v)}
        onOpenNews={() => setNewsOpen(true)}
        chatOpen={chatOpen}
      />

      <ThreadList
        threads={threads}
        selectedId={selectedId}
        onSelect={setSelectedId}
        query={query}
        onQueryChange={setQuery}
        loading={threadsLoading}
        title={title}
      />

      <ThreadView
        thread={detail?.thread ?? null}
        messages={detail?.messages ?? []}
        loading={detailLoading}
        onReplySent={() => selectedId && loadThread(selectedId)}
      />

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenThread={openThreadFromChat}
      />

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} />}
      {newsOpen && (
        <NewsModal
          onClose={() => setNewsOpen(false)}
          onOpenThread={openThreadFromChat}
        />
      )}
    </div>
  );
}
