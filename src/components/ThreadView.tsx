"use client";

import { useState } from "react";
import type { MessageRow, ThreadRow } from "@/lib/types";
import { api } from "@/lib/client";
import { CategoryChip, Spinner, cx, initials } from "./ui";

interface ThreadViewProps {
  thread: ThreadRow | null;
  messages: MessageRow[];
  loading: boolean;
  onReplySent: () => void;
}

export default function ThreadView(props: ThreadViewProps) {
  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-400">
        <Spinner className="text-gray-400" />
      </div>
    );
  }
  if (!props.thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--muted)]">
        <span className="text-4xl">📭</span>
        <p className="text-sm">Select a conversation to read it.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--bg)]">
      <div className="border-b border-[var(--border)] bg-white px-6 py-4">
        <div className="mb-1 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-900">
            {props.thread.subject || "(no subject)"}
          </h1>
          <CategoryChip category={props.thread.category} />
        </div>
        <p className="text-xs text-[var(--muted)]">
          {props.messages.length} message{props.messages.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 scroll-thin">
        {/* Thread-level AI summary */}
        {props.thread.summary && (
          <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
              ✨ Thread summary
            </div>
            <p className="prewrap text-sm leading-relaxed text-gray-700">
              {props.thread.summary}
            </p>
          </div>
        )}

        {props.messages.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
      </div>

      <ReplyComposer threadId={props.thread.id} onSent={props.onReplySent} />
    </div>
  );
}

function MessageCard({ message }: { message: MessageRow }) {
  const [expanded, setExpanded] = useState(false);
  const body = message.body_text || message.snippet || "";
  const long = body.length > 600;
  const shown = expanded || !long ? body : body.slice(0, 600) + "…";

  return (
    <div className="mb-3 rounded-xl border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {initials(message.from_name, message.from_email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">
            {message.from_name || message.from_email}
          </div>
          <div className="truncate text-xs text-[var(--muted)]">{message.from_email}</div>
        </div>
        <div className="shrink-0 text-xs text-[var(--muted)]">
          {message.internal_date
            ? new Date(message.internal_date).toLocaleString()
            : ""}
        </div>
      </div>

      {message.summary && (
        <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Gist: </span>
          {message.summary}
        </div>
      )}

      <p className="prewrap text-sm leading-relaxed text-gray-800">{shown}</p>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-brand-600 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ReplyComposer({ threadId, onSent }: { threadId: string; onSent: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function generate() {
    if (!prompt.trim()) return;
    setDrafting(true);
    setError("");
    try {
      const res = await api.replyDraft(threadId, prompt);
      setDraft(res.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft reply");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.sendReply(threadId, draft);
      setDone(true);
      setPrompt("");
      setDraft("");
      onSent();
      setTimeout(() => setDone(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-white p-4">
      {done && (
        <div className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ Reply sent.
        </div>
      )}
      {error && (
        <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder='Tell AI how to reply — e.g. "politely decline and suggest next week"'
          className="flex-1 rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white"
        />
        <button
          onClick={generate}
          disabled={drafting || !prompt.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
        >
          {drafting ? <Spinner /> : "✨"} Draft
        </button>
      </div>

      {draft && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-[var(--border)] p-3 text-sm leading-relaxed outline-none focus:border-brand-500 prewrap"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setDraft("")}
              className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              Discard
            </button>
            <button
              onClick={send}
              disabled={sending}
              className={cx(
                "flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50",
              )}
            >
              {sending ? <Spinner /> : "📨"} Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
