"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSource } from "@/lib/types";
import { api } from "@/lib/client";
import { Spinner, cx } from "./ui";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

const EXAMPLES = [
  "Summarize all emails from the past week",
  "Which companies rejected my job application?",
  "What's been discussed about any ongoing project?",
  "List important tech news from my newsletters",
];

export default function ChatPanel({
  open,
  onClose,
  onOpenThread,
}: {
  open: boolean;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await api.chat(q, sessionId);
      setSessionId(res.sessionId);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "Sorry — " + (e instanceof Error ? e.message : "something went wrong") + ".",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="flex w-[420px] shrink-0 flex-col border-l border-[var(--border)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <div>
            <h2 className="text-sm font-semibold">AI Assistant</h2>
            <p className="text-[11px] text-[var(--muted)]">Answers only from your emails</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scroll-thin">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Ask me anything about your inbox. I read across all your emails, synthesize
              the answer, and cite the sources.
            </p>
            <div className="space-y-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => ask(ex)}
                  className="block w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm text-gray-700 transition hover:border-brand-300 hover:bg-brand-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cx(m.role === "user" ? "flex justify-end" : "")}>
            <div
              className={cx(
                "max-w-[92%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-800",
              )}
            >
              <p className="prewrap">{m.content}</p>
              {m.sources && m.sources.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-gray-200 pt-2">
                  <p className="text-[11px] font-semibold text-gray-500">Sources</p>
                  {m.sources.map((s, idx) => (
                    <button
                      key={s.message_id}
                      onClick={() => onOpenThread(s.thread_id)}
                      className="block w-full rounded-md bg-white px-2 py-1.5 text-left text-xs text-gray-700 ring-1 ring-gray-200 transition hover:ring-brand-300"
                    >
                      <span className="font-medium text-brand-700">[S{idx + 1}]</span>{" "}
                      {s.subject || "(no subject)"}
                      <span className="block text-[11px] text-[var(--muted)]">
                        {s.from}
                        {s.date ? ` · ${new Date(s.date).toLocaleDateString()}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner className="text-gray-400" /> Searching your emails…
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder="Ask about your emails…"
            className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white"
          />
          <button
            onClick={() => ask(input)}
            disabled={loading || !input.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
