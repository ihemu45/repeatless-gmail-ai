import { getSupabaseAdmin } from "../supabase";
import { geminiEmbed, geminiGenerate } from "./gemini";
import { nimChatJSON } from "./nim";
import type { ChatSource, RetrievedChunk } from "../types";

/**
 * Retrieval-Augmented Generation pipeline for the chat agent.
 *
 * Flow:
 *   1. (follow-ups) rewrite the question into a standalone query using recent
 *      chat history, so retrieval works for "list them all" style follow-ups.
 *   2. embed the query (Gemini, RETRIEVAL_QUERY) and run cosine kNN over the
 *      user's email_chunks (pgvector, via the match_email_chunks SQL function).
 *   3. re-rank the candidates with the NIM model for precision.
 *   4. build a source-tagged context and have Gemini answer using ONLY that
 *      context, citing sources inline ([S1], [S2], …) and refusing to answer
 *      when the information isn't present.
 *
 * Source clarity: every retrieved chunk carries denormalised sender/subject/
 * date metadata, grouped per email into numbered sources. The model cites those
 * numbers, and we return the structured source list to the UI so the user can
 * see exactly which emails an answer came from.
 */

const RETRIEVE_K = 20;
const CONTEXT_MAX_SOURCES = 10;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RagAnswer {
  answer: string;
  sources: ChatSource[];
  retrievedCount: number;
}

export async function answerQuery(
  userId: string,
  question: string,
  history: ChatTurn[] = [],
): Promise<RagAnswer> {
  const standalone = await rewriteIfFollowUp(question, history);

  const queryEmbedding = await geminiEmbed(standalone, "RETRIEVAL_QUERY");
  let chunks = await retrieve(userId, queryEmbedding, RETRIEVE_K);

  if (chunks.length === 0) {
    return {
      answer:
        "I couldn't find anything about that in your emails. It may not have " +
        "been synced yet, or there may be no matching messages.",
      sources: [],
      retrievedCount: 0,
    };
  }

  chunks = await rerank(standalone, chunks);

  const { context, sources } = buildContext(chunks);

  let answer: string;
  try {
    answer = await generateAnswer(question, context, history);
  } catch (err) {
    // Degrade gracefully when the model is rate-limited (Gemini free tier):
    // still surface the matched source emails and ask the user to retry.
    if (isRateLimited(err)) {
      return {
        answer:
          "I found relevant emails for your question, but the AI model is rate-limited " +
          "right now (Gemini free tier). The matching emails are listed below — please " +
          "try again in a minute for the full answer.",
        sources,
        retrievedCount: chunks.length,
      };
    }
    throw err;
  }

  // Keep only the sources the model actually cited (fall back to all if the
  // model didn't use explicit [S#] markers).
  const cited = sources.filter((_, i) =>
    new RegExp(`\\[S${i + 1}\\]`).test(answer),
  );

  return {
    answer,
    sources: cited.length > 0 ? cited : sources,
    retrievedCount: chunks.length,
  };
}

function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(msg) || /quota|rate.?limit/i.test(msg);
}

// ----------------------------------------------------------------------------
//  Retrieval
// ----------------------------------------------------------------------------
async function retrieve(
  userId: string,
  embedding: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_email_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_user_id: userId,
    match_count: k,
    similarity_threshold: 0.0,
  });
  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return (data ?? []) as RetrievedChunk[];
}

// ----------------------------------------------------------------------------
//  Re-ranking (NIM secondary model)
// ----------------------------------------------------------------------------
async function rerank(
  query: string,
  candidates: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  if (candidates.length <= 4) return candidates;
  try {
    const list = candidates
      .map((c, i) => `[${i}] (${c.from_name || c.from_email}) ${c.content.slice(0, 350)}`)
      .join("\n\n");
    const res = await nimChatJSON<{ relevant: number[] }>(
      [
        {
          role: "system",
          content:
            "You are a search re-ranker. Given a user query and numbered email " +
            "passages, return the indices of passages relevant to answering the " +
            'query, most-relevant first. Respond ONLY as JSON: {"relevant":[indices]}.',
        },
        { role: "user", content: `Query: ${query}\n\nPassages:\n${list}` },
      ],
      { maxTokens: 200, temperature: 0 },
    );
    const order = (res.relevant ?? []).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < candidates.length,
    );
    if (order.length === 0) return candidates;
    const picked = order.map((i) => candidates[i]);
    // Append any not selected so we never lose recall entirely.
    const seen = new Set(order);
    candidates.forEach((c, i) => {
      if (!seen.has(i)) picked.push(c);
    });
    return picked;
  } catch {
    return candidates; // fall back to vector order
  }
}

// ----------------------------------------------------------------------------
//  Context building + generation
// ----------------------------------------------------------------------------
function buildContext(chunks: RetrievedChunk[]): {
  context: string;
  sources: ChatSource[];
} {
  // Group chunks by message → one numbered source per email.
  const order: string[] = [];
  const byMessage = new Map<string, RetrievedChunk[]>();
  for (const c of chunks) {
    if (!byMessage.has(c.message_id)) {
      byMessage.set(c.message_id, []);
      order.push(c.message_id);
    }
    byMessage.get(c.message_id)!.push(c);
  }

  const sources: ChatSource[] = [];
  const blocks: string[] = [];
  for (const messageId of order.slice(0, CONTEXT_MAX_SOURCES)) {
    const items = byMessage.get(messageId)!;
    const head = items[0];
    const n = sources.length + 1;
    sources.push({
      message_id: messageId,
      thread_id: head.thread_id,
      subject: head.subject,
      from: head.from_name || head.from_email,
      date: head.message_date,
    });
    const text = items
      .sort((a, b) => a.id - b.id)
      .map((c) => c.content)
      .join("\n");
    const when = head.message_date
      ? new Date(head.message_date).toLocaleDateString()
      : "unknown date";
    blocks.push(
      `[S${n}] From: ${head.from_name || head.from_email} | Subject: ${
        head.subject ?? "(no subject)"
      } | Date: ${when}\n${text}`,
    );
  }

  return { context: blocks.join("\n\n---\n\n"), sources };
}

const AGENT_SYSTEM = `You are an intelligent email assistant. You answer questions using ONLY the email excerpts provided to you as the user's knowledge base.

Rules:
- Use ONLY the provided excerpts. Do not use outside knowledge or assumptions.
- Each excerpt is tagged with a source marker like [S1], [S2]. Cite the relevant source marker(s) inline in your answer.
- When multiple emails discuss the same topic, SYNTHESIZE them into one coherent answer and cite every source you drew from.
- Be specific: name senders, companies, dates and facts exactly as they appear.
- If the answer is NOT present in the excerpts, say clearly that you don't have that information in the emails. NEVER fabricate or guess.
- Format lists clearly when the user asks for "all" of something.`;

async function generateAnswer(
  question: string,
  context: string,
  history: ChatTurn[],
): Promise<string> {
  const historyText =
    history.length > 0
      ? "Recent conversation:\n" +
        history
          .slice(-6)
          .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
          .join("\n") +
        "\n\n"
      : "";

  const prompt =
    `${historyText}` +
    `Email excerpts (the only knowledge you may use):\n\n${context}\n\n` +
    `Question: ${question}\n\n` +
    `Answer using only the excerpts above, citing sources like [S1].`;

  return geminiGenerate({
    system: AGENT_SYSTEM,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 1200,
  });
}

/** Rewrite a follow-up into a standalone query for better retrieval. */
async function rewriteIfFollowUp(
  question: string,
  history: ChatTurn[],
): Promise<string> {
  if (history.length === 0) return question;
  try {
    const recent = history
      .slice(-4)
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");
    const rewritten = await geminiGenerate({
      prompt:
        `Given the conversation and a follow-up question, rewrite the follow-up ` +
        `as a standalone search query that captures the user's full intent. ` +
        `Return only the rewritten query, nothing else.\n\n` +
        `Conversation:\n${recent}\n\nFollow-up: ${question}`,
      temperature: 0,
      maxOutputTokens: 100,
    });
    const clean = rewritten.trim();
    return clean.length > 3 ? clean : question;
  } catch {
    return question;
  }
}
