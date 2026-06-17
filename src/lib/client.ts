/** Browser-side fetch helpers. Thin wrappers over the JSON API routes. */
import type {
  ChatSource,
  EmailCategory,
  MessageRow,
  NewsClusterDTO,
  ThreadRow,
} from "./types";

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface MeResponse {
  user: { id: string; email: string; name: string | null; picture: string | null } | null;
  sync?: {
    status: string;
    initial_sync_done: boolean;
    total_synced: number;
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
}

export const api = {
  me: () => jsonFetch<MeResponse>("/api/auth/me"),

  sync: () =>
    jsonFetch<{ mode: string; fetched: number; initialSyncDone: boolean; more: boolean }>(
      "/api/sync",
      { method: "POST" },
    ),

  process: () =>
    jsonFetch<{ processed: number; remaining: number; more: boolean }>("/api/process", {
      method: "POST",
    }),

  stats: () => jsonFetch<{ counts: Record<string, number> }>("/api/stats"),

  threads: (params: { category?: string; q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params.category) sp.set("category", params.category);
    if (params.q) sp.set("q", params.q);
    if (params.page) sp.set("page", String(params.page));
    return jsonFetch<{ threads: ThreadRow[]; page: number }>(`/api/threads?${sp}`);
  },

  thread: (id: string) =>
    jsonFetch<{ thread: ThreadRow; messages: MessageRow[] }>(
      `/api/threads/${encodeURIComponent(id)}`,
    ),

  chat: (message: string, sessionId?: string) =>
    jsonFetch<{
      sessionId: string;
      answer: string;
      sources: ChatSource[];
      retrievedCount: number;
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),

  compose: (prompt: string) =>
    jsonFetch<{ subject: string; body: string }>("/api/compose", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  replyDraft: (threadId: string, prompt: string) =>
    jsonFetch<{ body: string; subject: string }>("/api/reply", {
      method: "POST",
      body: JSON.stringify({ threadId, prompt }),
    }),

  sendNew: (payload: { to: string[]; cc?: string[]; subject: string; body: string }) =>
    jsonFetch<{ ok: boolean; id: string }>("/api/send", {
      method: "POST",
      body: JSON.stringify({ mode: "new", ...payload }),
    }),

  sendReply: (threadId: string, body: string) =>
    jsonFetch<{ ok: boolean; id: string }>("/api/send", {
      method: "POST",
      body: JSON.stringify({ mode: "reply", threadId, body }),
    }),

  news: (days = 4) =>
    jsonFetch<{ clusters: NewsClusterDTO[]; itemCount: number; newsletterCount: number }>(
      `/api/news?days=${days}`,
    ),

  logout: () => jsonFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
};

export type { ChatSource, EmailCategory, MessageRow, ThreadRow };
