import { geminiGenerate } from "./gemini";

/**
 * Summarization (Gemini, primary model).
 *
 * Two levels:
 *   • per-message  — a tight 1–2 sentence gist used in list views.
 *   • thread-level — the conversation arc, with each reply understood in the
 *     context of the whole thread (NOT in isolation). Long threads are summarized
 *     hierarchically to stay within the model's context window.
 */

export async function summarizeMessage(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<string> {
  const prompt =
    `Summarize this email in 1–2 concise sentences. Capture the main point, ` +
    `any explicit request, and any action item or deadline. ` +
    `Use only information present in the email — do not invent details.\n\n` +
    `From: ${input.from}\n` +
    `Subject: ${input.subject}\n\n` +
    `${input.body.slice(0, 8000)}`;

  return geminiGenerate({ prompt, temperature: 0.2, maxOutputTokens: 200 });
}

export interface ThreadMessageForSummary {
  from: string;
  date: string | null;
  body: string;
  perMessageSummary?: string | null;
}

const THREAD_SYSTEM =
  "You summarize email threads for a busy professional. Always interpret each " +
  "message in the context of the entire conversation, not in isolation.";

export async function summarizeThread(input: {
  subject: string;
  messages: ThreadMessageForSummary[];
}): Promise<string> {
  const buildTranscript = (useSummaries: boolean) =>
    input.messages
      .map((m, i) => {
        const when = m.date ? new Date(m.date).toLocaleString() : "unknown date";
        const content =
          useSummaries && m.perMessageSummary
            ? m.perMessageSummary
            : m.body.slice(0, 4000);
        return `--- Message ${i + 1} | From: ${m.from} | ${when} ---\n${content}`;
      })
      .join("\n\n");

  // If the full transcript is large, fall back to per-message summaries
  // (hierarchical / map-reduce summarization) to stay within context.
  let transcript = buildTranscript(false);
  if (transcript.length > 24_000) transcript = buildTranscript(true);
  transcript = transcript.slice(0, 28_000);

  const prompt =
    `Summarize the following email thread in 3–5 sentences. Capture: what the ` +
    `conversation is about, the key points or decisions, the current status, and ` +
    `any open action items or pending replies. Do not invent information.\n\n` +
    `Subject: ${input.subject}\n\n${transcript}`;

  return geminiGenerate({
    system: THREAD_SYSTEM,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 500,
  });
}
