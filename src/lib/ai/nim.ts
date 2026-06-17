import { env } from "../env";
import { withBackoff } from "../ratelimit";

/**
 * NVIDIA NIM client (SECONDARY model).
 *
 * NIM exposes an OpenAI-compatible Chat Completions API, so we hit
 * `/chat/completions` directly. Its role in this system is deliberately scoped
 * to the high-volume, latency-sensitive, structured tasks where a fast 8B
 * instruct model is the right tool and offloading them keeps us inside Gemini's
 * free-tier rate limits:
 *
 *   1. Email categorization (one classification call per message).
 *   2. RAG re-ranking (scoring retrieved chunks for relevance to a query).
 *
 * See ARCHITECTURE.md → "Tool & Technology Decisions" for the rationale.
 */

function shouldRetry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|502|503|504)\b/.test(msg) || /overloaded|rate/i.test(msg);
}

export interface NimMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function nimChat(
  messages: NimMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  return withBackoff(
    async () => {
      const res = await fetch(`${env.nimBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.nimApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.nimModel,
          messages,
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxTokens ?? 512,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`NIM ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      return (data?.choices?.[0]?.message?.content ?? "").trim();
    },
    { shouldRetry, maxRetries: 4 },
  );
}

/**
 * Parse a JSON object out of a NIM completion, tolerant of code fences and
 * surrounding prose. Callers should still wrap in try/catch — a misbehaving
 * model can always defeat any heuristic. Throws if nothing parses.
 */
export async function nimChatJSON<T>(
  messages: NimMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const raw = await nimChat(messages, opts);
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // 1) The whole (de-fenced) response is often valid JSON.
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through */
  }
  // 2) Otherwise grab the first balanced-looking object.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]) as T;
  }
  throw new Error(`nimChatJSON: no JSON in completion: ${raw.slice(0, 200)}`);
}
