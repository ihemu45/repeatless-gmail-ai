"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Spinner } from "./ui";

export default function ComposeModal({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function generate() {
    if (!prompt.trim()) return;
    setDrafting(true);
    setError("");
    try {
      const res = await api.compose(prompt);
      setSubject(res.subject);
      setBody(res.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    const recipients = to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) return setError("Add at least one recipient.");
    if (!subject.trim() || !body.trim()) return setError("Subject and body are required.");
    setSending(true);
    setError("");
    try {
      await api.sendNew({ to: recipients, subject, body });
      setSent(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="animate-rise flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="font-semibold">✏️ Compose with AI</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 scroll-thin">
          {sent && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              ✓ Email sent.
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              What should this email say?
            </label>
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate()}
                placeholder='e.g. "Follow up with the product team about the Q3 launch delay"'
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
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To (comma-separated)"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Body — generate with AI above, or write your own…"
              className="w-full rounded-lg border border-[var(--border)] p-3 text-sm leading-relaxed outline-none focus:border-brand-500 prewrap"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="btn-primary flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {sending ? <Spinner /> : "📨"} Send
          </button>
        </div>
      </div>
    </div>
  );
}
