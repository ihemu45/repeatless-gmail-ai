import { getSupabaseAdmin } from "../supabase";
import { geminiEmbed, geminiGenerate } from "./gemini";
import { nimChat, nimChatJSON } from "./nim";
import { type ChatSource, type EmailCategory, type RetrievedChunk } from "../types";

/**
 * Hybrid Retrieval-Augmented Generation for the chat agent.
 *
 * Pure vector top-K can't satisfy the assignment's example queries — sender
 * filters ("from Acme Corp"), time windows ("this month", "past 4 days"), and
 * exhaustive listing ("list them all"). So retrieval is HYBRID:
 *
 *   1. Intent extraction (NIM) — rewrite to a standalone query and pull out
 *      structured slots: sender, category, date range, and whether the user
 *      wants an exhaustive list.
 *   2. Structured fetch — when slots are present, query the `messages` table
 *      directly (sender ILIKE / category / date between) for the COMPLETE
 *      matching set, so filtered + exhaustive queries are answered fully.
 *   3. Vector search — semantic kNN over `email_chunks` for topical queries.
 *   4. Thread expansion — load every message of the involved threads so the
 *      agent reasons over entire threads (threads as a first-class unit), not
 *      just the individually-similar chunks.
 *   5. Grounded generation — Gemini (NIM fallback) answers using ONLY the
 *      assembled, source-tagged context, citing [S#] and refusing when absent.
 */

const VECTOR_K = 24;
const STRUCTURED_CAP = 50;
const MAX_THREADS = 12;
const MAX_SOURCES_NORMAL = 16;
const MAX_SOURCES_EXHAUSTIVE = 40;
const CONTEXT_CHAR_BUDGET = 28_000;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RagAnswer {
  answer: string;
  sources: ChatSource[];
  retrievedCount: number;
}

interface MsgRow {
  id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  summary: string | null;
  internal_date: string | null;
  category: EmailCategory | null;
}

const MSG_FIELDS =
  "id, thread_id, from_name, from_email, subject, snippet, body_text, summary, internal_date, category";

interface Intent {
  standalone: string;
  sender: string | null;
  category: EmailCategory | null;
  dateFrom: string | null;
  dateTo: string | null;
  exhaustive: boolean;
}

// ----------------------------------------------------------------------------
//  Orchestration
// ----------------------------------------------------------------------------
export async function answerQuery(
  userId: string,
  question: string,
  history: ChatTurn[] = [],
): Promise<RagAnswer> {
  const intent = await extractIntent(question, history);

  // Structured + vector retrieval in parallel.
  const [structured, chunks] = await Promise.all([
    structuredFetch(userId, intent),
    vectorRetrieve(userId, intent.standalone),
  ]);

  const reranked = await rerank(intent.standalone, chunks);

  // Focus messages: the complete structured set first (so filtered/exhaustive
  // queries are answered fully), then the most semantically relevant.
  const focusRank = new Map<string, number>();
  let rank = 0;
  for (const m of structured) if (!focusRank.has(m.id)) focusRank.set(m.id, rank++);
  for (const c of reranked) if (!focusRank.has(c.message_id)) focusRank.set(c.message_id, rank++);

  if (focusRank.size === 0) {
    return {
      answer:
        "I couldn't find anything about that in your emails. It may not have " +
        "been synced yet, or there may be no matching messages.",
      sources: [],
      retrievedCount: 0,
    };
  }

  // Thread expansion: load every message of the focus threads, plus the full
  // rows of any structured matches whose thread didn't make the cap.
  const messages = await loadThreadContext(userId, focusRank, structured);

  const { context, sources } = buildContext(messages, focusRank, intent);

  let answer: string;
  try {
    answer = await generateAnswer(question, context, history, intent, sources.length);
  } catch (err) {
    if (isRateLimited(err)) {
      return {
        answer:
          "I found relevant emails for your question, but the AI model is rate-limited " +
          "right now (Gemini free tier). The matching emails are listed below — please " +
          "try again in a minute for the full answer.",
        sources,
        retrievedCount: sources.length,
      };
    }
    throw err;
  }

  // Keep only the sources the model actually cited (fall back to all).
  const cited = sources.filter((_, i) => new RegExp(`\\[S${i + 1}\\]`).test(answer));
  return {
    answer,
    sources: cited.length > 0 ? cited : sources,
    retrievedCount: sources.length,
  };
}

function isRateLimited(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(msg) || /quota|rate.?limit/i.test(msg);
}

// ----------------------------------------------------------------------------
//  1. Intent extraction — deterministic slot parsing (model-free, so it's
//     accurate and quota-independent), plus NIM only to resolve follow-ups.
// ----------------------------------------------------------------------------
async function extractIntent(question: string, history: ChatTurn[]): Promise<Intent> {
  // Resolve follow-ups ("list them all") into a standalone query using history.
  const standalone = await resolveStandalone(question, history);
  const text = `${standalone} ${question}`; // parse over both for robustness

  const { from, to } = parseDateRange(standalone);
  return {
    standalone,
    sender: extractSender(standalone),
    category: detectCategory(text),
    dateFrom: from,
    dateTo: to,
    exhaustive:
      /\b(all|every|each|entire|complete|list them|name them|which all|every single)\b/i.test(
        text,
      ),
  };
}

async function resolveStandalone(question: string, history: ChatTurn[]): Promise<string> {
  if (history.length === 0) return question;
  try {
    const recent = history
      .slice(-4)
      .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
      .join("\n");
    const rewritten = await nimChat(
      [
        {
          role: "system",
          content:
            "Rewrite the user's follow-up as a self-contained search query using the " +
            "conversation. Return ONLY the rewritten query, nothing else.",
        },
        { role: "user", content: `Conversation:\n${recent}\n\nFollow-up: ${question}` },
      ],
      { temperature: 0, maxTokens: 80 },
    );
    const clean = rewritten.trim().replace(/^["']|["']$/g, "");
    return clean.length > 3 ? clean : question;
  } catch {
    return question;
  }
}

/** Map a query to one of our categories by keyword. Deterministic and accurate
 * for the spec's example queries; null when the query is topical (no filter). */
function detectCategory(q: string): EmailCategory | null {
  const s = q.toLowerCase();
  if (/\b(job|jobs|application|applications|interview|recruit|recruiter|recruiting|hiring|offer letter|rejection|rejected|reject)\b/.test(s))
    return "job";
  if (/\b(newsletter|newsletters|news digest|digest|tech news|industry news|headlines|news)\b/.test(s))
    return "newsletters";
  if (/\b(payment|payments|invoice|invoices|receipt|receipts|bill|billing|bank|refund|refunds|charge|charged|transaction|subscription fee|paid)\b/.test(s))
    return "finance";
  if (/\b(security alert|otp|verification code|2fa|two-factor|notification|notifications|system alert)\b/.test(s))
    return "notifications";
  return null;
}

/** Pull a sender filter out of phrasings like "from Acme Corp" or "Acme's emails". */
function extractSender(q: string): string | null {
  let m = q.match(
    /\b(?:from|sent by|by sender|sender:?)\s+([A-Za-z0-9][\w.&'-]*(?:\s+[A-Za-z0-9][\w.&'-]*){0,3}?)(?=\s+(?:this|last|that|in|on|about|regarding|over|during|since|between|today|yesterday|emails?|messages?|mail|who|which)\b|[?!,.]|$)/i,
  );
  if (!m) {
    m = q.match(/\b([A-Z][\w.&'-]+(?:\s+[A-Z][\w.&'-]+){0,2})(?:'s)?\s+(?:emails?|messages?|mail)\b/);
  }
  if (!m) return null;
  const s = m[1].trim().replace(/['"]/g, "").replace(/\s+/g, " ");
  // reject generic pronouns / filler that aren't real senders
  if (/^(my|me|the|a|an|all|them|their|your|our|his|her|any|this|that)$/i.test(s)) return null;
  // reject captures that are really time phrases ("from the past 4 days")
  if (/\b(past|last|this|next|recent|yesterday|today|week|weeks|month|months|day|days|year|years)\b/i.test(s))
    return null;
  return s.slice(0, 80);
}

/** Deterministic relative-date parsing for the common windows. */
function parseDateRange(q: string): { from: string | null; to: string | null } {
  const s = q.toLowerCase();
  const now = new Date();
  const DAY = 86_400_000;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  let m = s.match(/\b(?:past|last|previous)\s+(\d+)\s*(day|week|month)s?\b/);
  if (m) {
    const n = Number(m[1]);
    const days = m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30;
    return { from: iso(new Date(todayUTC.getTime() - days * DAY)), to: iso(now) };
  }
  if (/\bthis month\b/.test(s))
    return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
  if (/\blast month\b/.test(s))
    return {
      from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
      to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
    };
  if (/\bthis week\b/.test(s)) {
    const start = todayUTC.getTime() - todayUTC.getUTCDay() * DAY;
    return { from: iso(new Date(start)), to: iso(now) };
  }
  if (/\blast week\b/.test(s)) {
    const thisWeekStart = todayUTC.getTime() - todayUTC.getUTCDay() * DAY;
    return { from: iso(new Date(thisWeekStart - 7 * DAY)), to: iso(new Date(thisWeekStart - DAY)) };
  }
  if (/\byesterday\b/.test(s)) {
    const y = new Date(todayUTC.getTime() - DAY);
    return { from: iso(y), to: iso(y) };
  }
  if (/\btoday\b/.test(s)) return { from: iso(todayUTC), to: iso(now) };
  if (/\bthis year\b/.test(s))
    return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: iso(now) };
  return { from: null, to: null };
}

// ----------------------------------------------------------------------------
//  2. Structured fetch (sender / category / date filters)
// ----------------------------------------------------------------------------
async function structuredFetch(userId: string, intent: Intent): Promise<MsgRow[]> {
  const hasFilter = Boolean(intent.sender || intent.category || intent.dateFrom || intent.dateTo);
  if (!hasFilter) return [];

  const supabase = getSupabaseAdmin();
  let q = supabase.from("messages").select(MSG_FIELDS).eq("user_id", userId);

  if (intent.sender) {
    const term = intent.sender.replace(/[,()%*]/g, "").trim();
    if (term) q = q.or(`from_name.ilike.%${term}%,from_email.ilike.%${term}%`);
  } else if (intent.category) {
    // Only filter by category when there's no sender — a sender filter is
    // specific enough, and category detection on a sender query can over-narrow.
    q = q.eq("category", intent.category);
  }
  if (intent.dateFrom) q = q.gte("internal_date", `${intent.dateFrom}T00:00:00Z`);
  if (intent.dateTo) q = q.lte("internal_date", `${intent.dateTo}T23:59:59Z`);

  const { data } = await q
    .order("internal_date", { ascending: false })
    .limit(STRUCTURED_CAP);
  return (data ?? []) as MsgRow[];
}

// ----------------------------------------------------------------------------
//  3. Vector search
// ----------------------------------------------------------------------------
async function vectorRetrieve(userId: string, standalone: string): Promise<RetrievedChunk[]> {
  try {
    const embedding = await geminiEmbed(standalone, "RETRIEVAL_QUERY");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("match_email_chunks", {
      query_embedding: JSON.stringify(embedding),
      match_user_id: userId,
      match_count: VECTOR_K,
      similarity_threshold: 0.0,
    });
    if (error) return [];
    return (data ?? []) as RetrievedChunk[];
  } catch {
    return []; // embedding may be rate-limited; structured fetch can still answer
  }
}

async function rerank(query: string, candidates: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  if (candidates.length <= 4) return candidates;
  try {
    const list = candidates
      .map((c, i) => `[${i}] (${c.from_name || c.from_email}) ${c.content.slice(0, 320)}`)
      .join("\n\n");
    const res = await nimChatJSON<{ relevant: number[] }>(
      [
        {
          role: "system",
          content:
            "You are a search re-ranker. Given a query and numbered email passages, " +
            'return passage indices relevant to the query, most-relevant first. JSON: {"relevant":[indices]}.',
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
    const seen = new Set(order);
    candidates.forEach((c, i) => {
      if (!seen.has(i)) picked.push(c);
    });
    return picked;
  } catch {
    return candidates;
  }
}

// ----------------------------------------------------------------------------
//  4. Thread expansion — load full threads for the focus messages
// ----------------------------------------------------------------------------
async function loadThreadContext(
  userId: string,
  focusRank: Map<string, number>,
  structured: MsgRow[],
): Promise<MsgRow[]> {
  const supabase = getSupabaseAdmin();

  // Determine the threads to expand: those of the highest-ranked focus messages.
  // We need each focus message's thread_id; structured rows carry it, and for
  // vector-only focus ids we look them up.
  const threadById = new Map<string, string>();
  for (const m of structured) threadById.set(m.id, m.thread_id);

  const unknownIds = [...focusRank.keys()].filter((id) => !threadById.has(id));
  if (unknownIds.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select("id, thread_id")
      .eq("user_id", userId)
      .in("id", unknownIds);
    for (const r of data ?? []) threadById.set(r.id, r.thread_id);
  }

  const threads = [...focusRank.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => threadById.get(id))
    .filter((t): t is string => Boolean(t));
  const focusThreads = [...new Set(threads)].slice(0, MAX_THREADS);

  // Load every message of those threads (complete thread history).
  const byId = new Map<string, MsgRow>();
  if (focusThreads.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select(MSG_FIELDS)
      .eq("user_id", userId)
      .in("thread_id", focusThreads)
      .order("internal_date", { ascending: true })
      .limit(200);
    for (const m of (data ?? []) as MsgRow[]) byId.set(m.id, m);
  }
  // Ensure every structured match is present even if its thread was cut.
  for (const m of structured) if (!byId.has(m.id)) byId.set(m.id, m);

  return [...byId.values()];
}

// ----------------------------------------------------------------------------
//  Context building — grouped by thread, source-tagged, within a char budget
// ----------------------------------------------------------------------------
function buildContext(
  messages: MsgRow[],
  focusRank: Map<string, number>,
  intent: Intent,
): { context: string; sources: ChatSource[] } {
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : "unknown date";

  // Group by thread.
  const threads = new Map<string, MsgRow[]>();
  for (const m of messages) {
    const arr = threads.get(m.thread_id) ?? [];
    arr.push(m);
    threads.set(m.thread_id, arr);
  }
  for (const arr of threads.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.internal_date ?? 0).getTime() - new Date(b.internal_date ?? 0).getTime(),
    );
  }

  // Order threads by the best (lowest) focus rank of their messages.
  const bestRank = (arr: MsgRow[]) =>
    Math.min(...arr.map((m) => focusRank.get(m.id) ?? Number.MAX_SAFE_INTEGER));
  const threadOrder = [...threads.entries()].sort((a, b) => bestRank(a[1]) - bestRank(b[1]));

  const maxSources = intent.exhaustive ? MAX_SOURCES_EXHAUSTIVE : MAX_SOURCES_NORMAL;
  const sources: ChatSource[] = [];
  const blocks: string[] = [];
  let used = 0;

  for (const [, arr] of threadOrder) {
    if (sources.length >= maxSources || used >= CONTEXT_CHAR_BUDGET) break;
    const subject = arr[0]?.subject ?? "(no subject)";
    const lines: string[] = [];
    for (const m of arr) {
      if (sources.length >= maxSources || used >= CONTEXT_CHAR_BUDGET) break;
      const n = sources.length + 1;
      const body = m.body_text || m.snippet || "";
      const remaining = CONTEXT_CHAR_BUDGET - used;
      // Full body when there's room; otherwise the per-message summary/snippet.
      const content =
        !intent.exhaustive && remaining > 2000
          ? body.slice(0, Math.min(3500, remaining))
          : m.summary || m.snippet || body.slice(0, 300);
      used += content.length + 90;
      sources.push({
        message_id: m.id,
        thread_id: m.thread_id,
        subject: m.subject,
        from: m.from_name || m.from_email,
        date: m.internal_date,
      });
      lines.push(
        `[S${n}] From: ${m.from_name || m.from_email} | ${date(m.internal_date)}` +
          `${m.category ? ` | ${m.category}` : ""}\n${content}`,
      );
    }
    if (lines.length > 0) {
      blocks.push(`Thread — "${subject}":\n${lines.join("\n\n")}`);
    }
  }

  return { context: blocks.join("\n\n====\n\n"), sources };
}

// ----------------------------------------------------------------------------
//  5. Grounded generation (Gemini → NIM fallback)
// ----------------------------------------------------------------------------
const AGENT_SYSTEM = `You are an intelligent email assistant. You answer using ONLY the email excerpts provided as the user's knowledge base.

Rules:
- Use ONLY the provided excerpts. No outside knowledge or assumptions.
- Be precise and concise. Lead with the direct answer, then only the supporting detail needed.
- Excerpts are grouped by thread and tagged [S1], [S2], … Put the relevant marker right after the fact it supports (e.g. "...payment of $10 received [S3]."). One marker per fact.
- When multiple emails discuss the same topic, SYNTHESIZE them into one coherent answer and cite each source.
- When the excerpts include a full thread, reason over the WHOLE thread, not a single message.
- Be specific: name senders, companies, dates and amounts exactly as they appear.
- If the answer is NOT in the excerpts, say clearly you don't have that information. NEVER fabricate or guess.
- For "list all / every" questions, output a bulleted list with one item per matching email — the excerpts are the complete candidate set, so include every match.`;

async function generateAnswer(
  question: string,
  context: string,
  history: ChatTurn[],
  intent: Intent,
  sourceCount: number,
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

  const filters: string[] = [];
  if (intent.sender) filters.push(`sender ~ "${intent.sender}"`);
  if (intent.category) filters.push(`category = ${intent.category}`);
  if (intent.dateFrom || intent.dateTo)
    filters.push(`date ${intent.dateFrom ?? "…"} → ${intent.dateTo ?? "…"}`);
  const scope =
    filters.length > 0
      ? `The excerpts below are the COMPLETE set of ${sourceCount} emails matching: ${filters.join(
          ", ",
        )}. Base your answer only on them.\n\n`
      : "";

  const prompt =
    `${historyText}${scope}` +
    `Email excerpts (the only knowledge you may use):\n\n${context}\n\n` +
    `Question: ${question}\n\n` +
    `Answer using only the excerpts above, citing sources like [S1].`;

  try {
    return await geminiGenerate({
      system: AGENT_SYSTEM,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 1400,
    });
  } catch (err) {
    if (!isRateLimited(err)) throw err;
    return nimChat(
      [
        { role: "system", content: AGENT_SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxTokens: 1400 },
    );
  }
}
