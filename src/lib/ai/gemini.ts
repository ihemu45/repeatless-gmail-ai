import { env, EMBEDDING_DIM } from "../env";
import { withBackoff } from "../ratelimit";

/**
 * Google Gemini client (PRIMARY model).
 *
 * We call the Generative Language REST API directly with fetch — no SDK — so
 * the request/response shape is fully transparent and version-stable. Gemini
 * handles the heavy reasoning: email + thread summarization, draft generation,
 * the chat agent, and document embeddings (text-embedding-004, 768-dim) that
 * back the pgvector index.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function shouldRetry(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|502|503|504)\b/.test(msg) || /overloaded|rate/i.test(msg);
}

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean;
}

export async function geminiGenerate(opts: GenerateOptions): Promise<string> {
  const model = env.geminiModel;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  return withBackoff(
    async () => {
      const res = await fetch(
        `${BASE}/models/${model}:generateContent?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
    },
    { shouldRetry, maxRetries: 4 },
  );
}

/** Generate and parse a JSON response. Tolerates code-fence wrapping. */
export async function geminiGenerateJSON<T>(opts: GenerateOptions): Promise<T> {
  const raw = await geminiGenerate({ ...opts, json: true });
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY";

// Gemini's batchEmbedContents caps the number of requests per call (100).
const EMBED_BATCH_LIMIT = 100;

export async function geminiEmbed(
  text: string,
  taskType: EmbedTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const [vec] = await geminiEmbedBatch([text], taskType);
  if (!vec) throw new Error("Embedding API returned no vector");
  return vec;
}

/** Batch embedding. Splits large inputs into sub-batches under the API limit. */
export async function geminiEmbedBatch(
  texts: string[],
  taskType: EmbedTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_LIMIT) {
    const slice = texts.slice(i, i + EMBED_BATCH_LIMIT);
    out.push(...(await embedSubBatch(slice, taskType)));
  }
  return out;
}

async function embedSubBatch(
  texts: string[],
  taskType: EmbedTaskType,
): Promise<number[][]> {
  const model = env.geminiEmbedModel;
  const requests = texts.map((t) => ({
    model: `models/${model}`,
    content: { parts: [{ text: t.slice(0, 8000) }] },
    taskType,
    // Pin the output size to match the pgvector(768) column. gemini-embedding-001
    // defaults to 3072 dims unless this is set.
    outputDimensionality: EMBEDDING_DIM,
  }));

  return withBackoff(
    async () => {
      const res = await fetch(
        `${BASE}/models/${model}:batchEmbedContents?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini embed ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const embeddings: number[][] = (data?.embeddings ?? []).map(
        (e: { values: number[] }) => e.values,
      );
      if (embeddings.length !== texts.length) {
        throw new Error(
          `Embedding count mismatch: got ${embeddings.length}, expected ${texts.length}`,
        );
      }
      for (const e of embeddings) {
        if (e.length !== EMBEDDING_DIM) {
          throw new Error(
            `Unexpected embedding dimension ${e.length} (expected ${EMBEDDING_DIM})`,
          );
        }
      }
      return embeddings;
    },
    { shouldRetry, maxRetries: 4 },
  );
}
