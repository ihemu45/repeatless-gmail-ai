import { getSupabaseAdmin } from "../supabase";
import { geminiEmbedBatch, geminiGenerateJSON } from "./gemini";
import { createLimiter } from "../ratelimit";

/**
 * Newsletter deduplication (bonus).
 *
 * The same story is often carried by several newsletters. We:
 *   1. pull recent newsletter-category emails,
 *   2. extract discrete news items from each (Gemini structured extraction),
 *   3. embed every item and greedily cluster by cosine similarity — so
 *      near-duplicates collapse even when their headlines differ wording,
 *   4. return one entry per unique story, attributed to every source that
 *      carried it.
 */

const SIMILARITY_THRESHOLD = 0.8;
const EXTRACT_CONCURRENCY = 3;

export interface NewsItem {
  title: string;
  summary: string;
  url?: string;
  source: string;
  messageId: string;
  threadId: string;
  date: string | null;
}

export interface NewsCluster {
  title: string;
  summary: string;
  sources: Array<{ source: string; messageId: string; threadId: string }>;
  count: number;
}

interface NewsletterRow {
  id: string;
  thread_id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  body_text: string | null;
  snippet: string | null;
  internal_date: string | null;
}

async function extractItems(m: NewsletterRow): Promise<NewsItem[]> {
  try {
    const res = await geminiGenerateJSON<{
      items: { title: string; summary?: string; url?: string }[];
    }>({
      system:
        "You extract distinct news stories from a newsletter email. Return ONLY " +
        'JSON: {"items":[{"title":string,"summary":string,"url":string}]}. ' +
        "Each item is one discrete story. Keep summary to one sentence. If the " +
        "email contains no discrete news stories, return {\"items\":[]}.",
      prompt:
        `Subject: ${m.subject ?? ""}\nFrom: ${m.from_name || m.from_email}\n\n` +
        `${(m.body_text || m.snippet || "").slice(0, 12000)}`,
      temperature: 0.1,
      maxOutputTokens: 1600,
    });
    return (res.items ?? [])
      .filter((it) => it.title?.trim())
      .map((it) => ({
        title: it.title.trim(),
        summary: (it.summary ?? "").trim(),
        url: it.url,
        source: m.from_name || m.from_email || "Unknown",
        messageId: m.id,
        threadId: m.thread_id,
        date: m.internal_date,
      }));
  } catch {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export async function getNewsDigest(
  userId: string,
  days = 4,
  maxNewsletters = 20,
): Promise<{ clusters: NewsCluster[]; itemCount: number; newsletterCount: number }> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: msgs } = await supabase
    .from("messages")
    .select(
      "id, thread_id, subject, from_name, from_email, body_text, snippet, internal_date",
    )
    .eq("user_id", userId)
    .eq("category", "newsletters")
    .gte("internal_date", since)
    .order("internal_date", { ascending: false })
    .limit(maxNewsletters);

  const newsletters = (msgs ?? []) as NewsletterRow[];
  if (newsletters.length === 0) {
    return { clusters: [], itemCount: 0, newsletterCount: 0 };
  }

  // Extract items (bounded concurrency).
  const limit = createLimiter(EXTRACT_CONCURRENCY);
  const lists = await Promise.all(newsletters.map((m) => limit(() => extractItems(m))));
  const items = lists.flat();
  if (items.length === 0) {
    return { clusters: [], itemCount: 0, newsletterCount: newsletters.length };
  }

  // Embed + greedily cluster by semantic similarity.
  let embeddings: number[][] = [];
  try {
    embeddings = await geminiEmbedBatch(
      items.map((i) => `${i.title}. ${i.summary}`),
      "SEMANTIC_SIMILARITY",
    );
  } catch {
    embeddings = [];
  }

  const clusters: { centroid: number[]; items: NewsItem[] }[] = [];
  if (embeddings.length === items.length) {
    items.forEach((item, idx) => {
      const emb = embeddings[idx];
      let bestIdx = -1;
      let bestSim = 0;
      clusters.forEach((c, ci) => {
        const sim = cosine(emb, c.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = ci;
        }
      });
      if (bestIdx >= 0 && bestSim >= SIMILARITY_THRESHOLD) {
        clusters[bestIdx].items.push(item);
      } else {
        clusters.push({ centroid: emb, items: [item] });
      }
    });
  } else {
    // Embedding failed — fall back to one cluster per item (no dedup).
    items.forEach((item) => clusters.push({ centroid: [], items: [item] }));
  }

  const result: NewsCluster[] = clusters
    .map((c) => {
      const seen = new Set<string>();
      const sources = c.items
        .filter((i) => {
          if (seen.has(i.messageId)) return false;
          seen.add(i.messageId);
          return true;
        })
        .map((i) => ({
          source: i.source,
          messageId: i.messageId,
          threadId: i.threadId,
        }));
      return {
        title: c.items[0].title,
        summary: c.items[0].summary,
        sources,
        count: sources.length,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    clusters: result,
    itemCount: items.length,
    newsletterCount: newsletters.length,
  };
}
