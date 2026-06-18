import { getSupabaseAdmin } from "../supabase";
import { createLimiter } from "../ratelimit";
import { summarizeMessage } from "./summarize";
import { categorizeEmail } from "./categorize";
import { chunkText } from "./chunk";
import { geminiEmbedBatch } from "./gemini";
import type { EmailCategory } from "../types";

/**
 * AI enrichment pipeline.
 *
 * Sync (lib/google/sync.ts) only ingests raw email. This stage turns raw rows
 * into intelligence: a per-message summary (Gemini), a category (NIM), and
 * embedded chunks for the RAG index (Gemini embeddings). It's deliberately
 * decoupled from sync so a slow/failed AI call never blocks email ingestion,
 * and so it can be retried and resumed independently.
 *
 * Each message is marked `embedded = true` once done, making this idempotent
 * and resumable — the caller polls until `more === false`.
 */

const AI_CONCURRENCY = 3; // gentle on Gemini free-tier rate limits

export interface ProcessResult {
  processed: number;
  remaining: number;
  more: boolean;
}

interface PendingRow {
  id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  internal_date: string | null;
  summary: string | null;
  category: string | null;
  embedded: boolean;
}

/** A message still needs work if it isn't embedded OR has no summary yet. */
const PENDING_FILTER = "embedded.eq.false,summary.is.null";

export async function processPending(
  userId: string,
  opts: { batchSize?: number; budgetMs?: number } = {},
): Promise<ProcessResult> {
  const supabase = getSupabaseAdmin();
  const batchSize = opts.batchSize ?? 24;
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const limit = createLimiter(AI_CONCURRENCY);

  let processed = 0;
  const touchedThreads = new Set<string>();

  while (Date.now() < deadline) {
    const { data: pending } = await supabase
      .from("messages")
      .select(
        "id, thread_id, from_name, from_email, subject, snippet, body_text, internal_date, summary, category, embedded",
      )
      .eq("user_id", userId)
      .or(PENDING_FILTER)
      .limit(batchSize);

    if (!pending || pending.length === 0) break;

    await Promise.all(
      (pending as PendingRow[]).map((m) =>
        limit(async () => {
          await processOne(userId, m);
          touchedThreads.add(m.thread_id);
        }),
      ),
    );
    processed += pending.length;
  }

  await refreshThreadCategories(userId, [...touchedThreads]);

  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .or(PENDING_FILTER);
  const remaining = count ?? 0;

  return { processed, remaining, more: remaining > 0 };
}

async function processOne(userId: string, m: PendingRow): Promise<void> {
  const supabase = getSupabaseAdmin();
  const fromLabel = m.from_name
    ? `${m.from_name} <${m.from_email ?? ""}>`
    : m.from_email ?? "unknown sender";
  const body = m.body_text || m.snippet || "";

  // Only do the work that's actually missing — so a message that's already
  // embedded but lost its summary to a rate limit just retries the summary,
  // without re-embedding (which would waste quota).
  const needSummary = !m.summary;
  const needCategory = !m.category;
  const needEmbed = !m.embedded;

  const [summary, category] = await Promise.all([
    needSummary
      ? summarizeMessage({ from: fromLabel, subject: m.subject ?? "", body }).catch(
          () => null,
        )
      : Promise.resolve(m.summary),
    needCategory
      ? categorizeEmail({
          from: fromLabel,
          subject: m.subject ?? "",
          snippet: m.snippet ?? "",
          body,
        })
      : Promise.resolve(m.category as EmailCategory),
  ]);

  let embeddingOk = !needEmbed; // already embedded ⇒ nothing to do
  if (needEmbed) {
    // Prefix each chunk's source so retrieved snippets are self-describing.
    const header = `Subject: ${m.subject ?? "(no subject)"}\nFrom: ${fromLabel}`;
    const chunks = chunkText(`${header}\n\n${body}`);

    // Idempotent: clear any prior chunks for this message first.
    await supabase
      .from("email_chunks")
      .delete()
      .eq("user_id", userId)
      .eq("message_id", m.id);

    embeddingOk = chunks.length === 0; // empty body ⇒ nothing to embed
    if (chunks.length > 0) {
      try {
        const embeddings = await geminiEmbedBatch(chunks, "RETRIEVAL_DOCUMENT");
        if (embeddings.length === chunks.length) {
          const rows = chunks.map((content, i) => ({
            user_id: userId,
            message_id: m.id,
            thread_id: m.thread_id,
            chunk_index: i,
            content,
            from_email: m.from_email,
            from_name: m.from_name,
            subject: m.subject,
            message_date: m.internal_date,
            embedding: JSON.stringify(embeddings[i]), // pgvector literal
          }));
          await supabase.from("email_chunks").insert(rows);
          embeddingOk = true;
        }
      } catch (err) {
        console.error(`Embedding failed for message ${m.id}`, err);
        embeddingOk = false;
      }
    }
  }

  // Persist only the fields we (re)computed. `embedded` gates reprocessing and
  // is only set true once embeddings exist; a null summary will be retried on a
  // later pass.
  const update: Record<string, unknown> = { embedded: embeddingOk };
  if (needSummary) update.summary = summary;
  if (needCategory) update.category = category;
  await supabase.from("messages").update(update).eq("user_id", userId).eq("id", m.id);
}

/** Set each touched thread's category to its most recent message's category. */
async function refreshThreadCategories(
  userId: string,
  threadIds: string[],
): Promise<void> {
  if (threadIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { data: msgs } = await supabase
    .from("messages")
    .select("thread_id, category, internal_date")
    .eq("user_id", userId)
    .in("thread_id", threadIds)
    .not("category", "is", null);
  if (!msgs) return;

  const latest = new Map<string, { category: EmailCategory; date: number }>();
  for (const m of msgs) {
    const date = new Date(m.internal_date ?? 0).getTime();
    const prev = latest.get(m.thread_id);
    if (!prev || date > prev.date) {
      latest.set(m.thread_id, { category: m.category as EmailCategory, date });
    }
  }

  const rows = [...latest.entries()].map(([id, v]) => ({
    id,
    user_id: userId,
    category: v.category,
  }));
  if (rows.length > 0) {
    await supabase.from("threads").upsert(rows, { onConflict: "user_id,id" });
  }
}
