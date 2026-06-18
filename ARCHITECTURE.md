# Architecture & Design — Repeatless Gmail AI

An AI-powered Gmail Intelligence Platform: it connects to a user's Gmail over
OAuth 2.0, syncs and enriches their mail, and exposes an AI assistant that
summarizes, categorizes, drafts, and answers questions grounded **only** in the
user's own emails.

---

## 1. System Architecture

### Components

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Browser (React / Next.js)                         │
│   InboxApp ── Sidebar · ThreadList · ThreadView · ChatPanel · Compose/News │
└───────────────┬────────────────────────────────────────────────────────────┘
                │  JSON over HTTPS (same-origin /api/*)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    Next.js Route Handlers (Node runtime)                   │
│                                                                            │
│  Auth:    /api/auth/google · /callback · /logout · /me                     │
│  Sync:    /api/sync · /api/process · /api/sync/cron (Vercel Cron)          │
│  Read:    /api/threads · /api/threads/[id] · /api/stats                    │
│  Act:     /api/compose · /api/reply · /api/send                            │
│  AI:      /api/chat (RAG) · /api/news (dedup)                              │
│                                                                            │
│  lib/google (oauth, gmail, sync, send) · lib/ai (gemini, nim, rag, …)      │
└───────┬───────────────────┬───────────────────┬───────────────────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌─────────────────────────────────┐
│   Gmail API   │   │  Google Gemini │   │   NVIDIA NIM (OpenAI-compatible) │
│  (OAuth 2.0)  │   │  gen + embed   │   │  classification + reranking     │
└───────────────┘   └───────────────┘   └─────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│             Supabase (Postgres + pgvector)                                 │
│  users · sync_state · threads · messages · email_chunks(vector) ·          │
│  chat_sessions · chat_messages · news_items   +  match_email_chunks()      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Request flows

**Authentication.** `/api/auth/google` builds a Google consent URL (offline
access, Gmail scopes) with a CSRF `state` cookie. `/api/auth/callback`
validates state, exchanges the code, verifies the `id_token`, upserts the user,
stores the **encrypted** refresh token, and mints an HttpOnly signed-JWT session
cookie. The browser never sees Google tokens.

**Sync (two stages, both resumable).** The client calls `/api/sync` in a loop
to ingest raw mail (initial backfill, then incremental), then `/api/process` in
a loop to enrich it (summaries, categories, embeddings). Each call is bounded by
a time budget so it fits inside a serverless function; progress is persisted in
`sync_state`. A Vercel Cron job hits `/api/sync/cron` hourly to keep mail
fresh without the user present.

**Chat (RAG).** `/api/chat` embeds the query, runs cosine kNN over the user's
`email_chunks`, re-ranks with NIM, builds a source-tagged context, and has
Gemini answer using only that context with inline citations.

### Why this shape

A single Next.js app (UI + API in one deployable) is the fastest path to a
working, deployable product within the assessment window, and it matches the
"deploy on Vercel" requirement with zero infra glue. The AI and Gmail logic
lives in framework-agnostic modules under `src/lib`, so the route handlers stay
thin and the core could be lifted into a separate service later if scale
demanded it.

### Background processing on serverless

Serverless functions are time-bounded, so long jobs (syncing thousands of
emails, embedding them) are modelled as **resumable, idempotent batches** driven
by a watermark in `sync_state` rather than one long-running worker. The client
polls to completion for immediate feedback; Vercel Cron drives steady-state
incremental sync. This avoids needing a dedicated queue/worker for the MVP while
remaining correct under timeouts and retries. (A managed queue is the natural
next step — see §6.)

---

## 2. Database Schema

Postgres on Supabase, with the `vector` (pgvector) and `pgcrypto` extensions.
Full DDL: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).

| Table | Purpose | Key columns |
|---|---|---|
| `users` | one row per Google account | `google_sub` (unique), `email`, `google_refresh_token` (AES-256-GCM encrypted) |
| `sync_state` | per-user sync watermark | `last_history_id`, `next_page_token`, `initial_sync_done`, `status`, `total_synced` |
| `threads` | first-class conversations | PK `(user_id, id)`, `subject`, `participants`, `message_count`, `last_message_at`, `category`, `summary` |
| `messages` | individual emails | PK `(user_id, id)`, `rfc822_message_id`, `in_reply_to`, `references_header`, `body_text`, `label_ids`, `category`, `summary`, `embedded` |
| `email_chunks` | RAG knowledge base | `embedding vector(768)`, `content`, denormalized `from_*`/`subject`/`message_date` |
| `chat_sessions` / `chat_messages` | agent conversation history | `role`, `content`, `sources` (jsonb) |
| `news_items` | newsletter dedup (bonus) | `title`, `embedding vector(768)`, `cluster_id` |

### Modeling decisions

- **Composite primary keys `(user_id, id)`** on `threads`/`messages`. Gmail IDs
  are unique per user, and this key makes every row physically partitioned by
  owner — a natural multi-tenant boundary and the basis for all `user_id`-scoped
  queries.
- **Threads are first-class**, not derived on the fly. Aggregates (subject,
  participants, count, last activity, category, summary) are materialized by the
  sync engine so the inbox list is a single fast indexed read.
- **Thread headers are preserved** (`rfc822_message_id`, `in_reply_to`,
  `references_header`) precisely so AI replies can set `In-Reply-To`/`References`
  and thread correctly in Gmail.
- **Denormalized source metadata on `email_chunks`.** Each chunk carries its
  sender/subject/date, so retrieval can attribute an answer to a specific email
  without extra joins — directly serving the "source clarity" requirement.
- **`embedded` boolean + partial index** (`where embedded = false`) makes the
  enrichment processor a cheap "find the next batch of unprocessed messages"
  query, and makes the whole pipeline idempotent and resumable.

### Indexes

- B-tree on `(user_id, internal_date desc)`, `(user_id, thread_id)`,
  `(user_id, category)` for inbox/category/thread reads.
- **HNSW** `vector_cosine_ops` on `email_chunks.embedding` and
  `news_items.embedding` for fast approximate nearest-neighbour search.
- Partial index on unembedded messages to drive the processor.

### pgvector usage

We embed **email content chunks** (subject + sender + body, split into
overlapping ~1200-char chunks) with Gemini `gemini-embedding-001` at **768
dimensions** (the GA replacement for the deprecated `text-embedding-004`). This
is what the chat agent's vector stage searches. Retrieval is exposed as a SQL function
`match_email_chunks(query_embedding, user_id, k, threshold)` returning cosine
similarity, called via `supabase.rpc()` — keeping the vector math in Postgres
where the HNSW index lives.

### Security / RLS

The app reaches Postgres only via the service-role key from trusted server code,
and **every query is explicitly scoped by `user_id`** derived from the signed
session. RLS is enabled on all tables as defence-in-depth: with no policies
granted to the anon role, direct anon access is denied by default, while the
service role bypasses RLS so application queries work unchanged.

---

## 3. AI Design

### Summarization & context strategy

- **Per-message summary** (Gemini): a tight 1–2 sentence gist, generated during
  enrichment and shown in list/detail views.
- **Thread-level summary** (Gemini, lazy on open): the full thread is rendered
  as a chronological transcript and summarized with an instruction to interpret
  every message *in the context of the whole conversation*. For long threads we
  fall back to **hierarchical summarization** — swap each message's body for its
  per-message summary, then summarize the summaries — keeping us inside the
  context window. Thread summaries are cached and regenerated only when newer
  messages arrive (`summary_updated_at < last_message_at`).

### Hybrid RAG pipeline (the chat agent)

Pure vector top-K can't satisfy the spec's example queries — sender filters
("from Acme Corp"), time windows ("this month", "past 4 days"), and **exhaustive**
listing ("which companies rejected me — list them all"). So retrieval is
**hybrid**:

1. **Intent extraction** — resolve follow-ups to a standalone query (NIM), then
   parse structured slots **deterministically in code** (no model, so it's
   accurate and quota-independent): `sender`, `category`, a relative **date
   range** ("past 4 days" → absolute bounds), and an **exhaustive** flag.
2. **Structured fetch** — when slots are present, query the `messages` table
   directly (`from_*` ILIKE, `category =`, `internal_date` between) for the
   **complete** matching set (sender wins over category to avoid over-narrowing).
   This is what makes filtered and "list them all" queries answerable in full.
3. **Vector search** — embed the standalone query (Gemini `RETRIEVAL_QUERY`) and
   run cosine kNN over `email_chunks` (`match_email_chunks`, HNSW) for topical
   queries; **re-ranked** by NIM (fallback to vector order).
4. **Thread expansion** — collect the threads of the focus messages and load
   **every** message in them, so the agent reasons over entire threads (threads
   as a first-class unit), not just the individually-similar chunks.
5. **Context assembly** — group by thread, tag each email as a numbered source
   `[S1], [S2], …` (sender/subject/date), and pack within a char budget (full
   bodies when there's room, per-message summaries when listing many).
6. **Generate** — Gemini (NIM fallback) answers using **only** the context, with
   a scope note for filtered queries ("the complete set of N emails matching …"),
   cites `[S#]`, synthesizes across emails, and refuses when the answer is absent.
7. **Attribute** — return the structured source list to the UI; keep the sources
   the model actually cited.

### Source clarity across multiple emails

Every retrieved chunk is self-describing (denormalized sender/subject/date), the
context numbers each source, and the prompt requires inline `[S#]` citations.
Cross-email questions ("what do I know about X?") therefore produce one
synthesized answer that cites each contributing email, and the UI renders those
sources as clickable links back to the thread.

### Why this NVIDIA NIM model

We use **`meta/llama-3.1-8b-instruct`** (configurable via `NVIDIA_NIM_MODEL`) on
NIM's free tier. Its role is the **high-volume, structured, latency-sensitive**
work where an 8B instruct model is the right size:

- **Categorization** — one classification call per message; cheap, deterministic
  (temp 0), JSON-constrained.
- **RAG re-ranking** — scoring/ordering retrieved passages for relevance.
- **Follow-up rewriting** — turning a conversational follow-up into a standalone
  query (the only model step in intent extraction; the rest is deterministic).
- **Answer-generation fallback** — if Gemini is rate-limited (free-tier quota),
  the chat agent falls back to NIM to generate the grounded, cited answer. NIM
  has a separate quota, so the assistant stays available; this also exercises
  both required models on the critical path.

This is a deliberate division of labour: Gemini handles open-ended reasoning
(summaries, drafting, the final grounded answer) where quality matters most,
while NIM absorbs the repetitive classification/ranking volume. That keeps us
within Gemini's free-tier rate limits and satisfies the assignment's requirement
to meaningfully use both a primary and a secondary model.

### Hallucination prevention

- The agent is instructed to use **only** the provided excerpts and to refuse
  when information is absent.
- Retrieval is **user-scoped** in SQL, so cross-account leakage is impossible.
- Generation runs at **low temperature** (0.2).
- **Inline citations** make every claim auditable against a named source; the UI
  surfaces them so the user can verify.
- Unrelated content can't be "mixed up" because each source is explicitly
  delimited and numbered in the context, and the model must attribute per claim.

---

## 4. Gmail API Strategy

### Initial vs. incremental sync

- **Initial backfill**: paginate `users.messages.list` (100/page), fan out
  `users.messages.get` (concurrency-capped), parse, and upsert. The page token
  is persisted to `sync_state.next_page_token` after **every page**, so a
  serverless invocation can stop at its time budget and the next call resumes
  exactly where it left off. On completion we record the current `historyId`.
- **Incremental**: `users.history.list` from the stored `historyId` pulls only
  `messageAdded`/`messageDeleted` since the watermark; we apply those deltas and
  advance the watermark. This is what the hourly cron uses.

### Pagination for large inboxes

Sync never holds the whole mailbox in memory — it streams page by page,
persisting progress between pages. Thousands of emails are handled as many small
resumable batches rather than one giant request, so the app degrades gracefully
(it just takes more batches) instead of timing out or OOM-ing.

### Rate limiting & quota handling

All Gmail calls go through `gmailFetch`, which wraps every request in
**exponential backoff with jitter** and retries only **transient** failures:
HTTP 429, 5xx, and the overloaded HTTP 403 cases that carry
`rateLimitExceeded` / `userRateLimitExceeded` (permission 403s are *not*
retried). Outbound `messages.get` fan-out is bounded by a **concurrency limiter**
(8 in flight) so we never burst past per-user quota. Time-bounded batches further
smooth request rate over multiple invocations.

### Thread handling

Threads are modelled explicitly (`threads` table). Replies are sent with
`In-Reply-To` + `References` derived from the thread's latest message and Gmail's
`threadId`, so sent mail threads correctly for both the user and the recipient.

---

## 5. Tool & Technology Decisions

| Choice | Why |
|---|---|
| **Next.js 15 (App Router) + TypeScript** | One deployable for UI + API; first-class on Vercel; server route handlers keep secrets server-side; types across the stack. |
| **Vercel** | Required-friendly deploy target; Cron for incremental sync; per-route `maxDuration`. |
| **Supabase (Postgres + pgvector)** | Required. Relational model fits threads/messages; pgvector keeps embeddings next to the data (no separate vector DB to operate). |
| **Gemini (primary)** | Required. Strong summarization/reasoning + an embedding model (`text-embedding-004`) from one provider. Called via REST (no SDK) for transparency and version stability. |
| **NVIDIA NIM (secondary)** | Required. OpenAI-compatible; a fast 8B model is ideal for high-volume classification + reranking. |
| **`google-auth-library` (only Google dep)** | Correct, well-tested OAuth token exchange/refresh and `id_token` verification. Gmail data calls use plain `fetch` for full control over batching/limits. |
| **`jose` + Node `crypto`** | Stateless signed-JWT sessions (no session store) and AES-256-GCM encryption of refresh tokens at rest. |
| **No job-queue dependency (MVP)** | Resumable batches + Vercel Cron cover the workload without operating extra infra; revisit at scale. |
| **Direct `fetch` over heavy SDKs (Gmail/Gemini/NIM)** | Smaller dependency surface, fully explainable request/response, no SDK-churn risk. |

---

## 6. Trade-offs & Limitations

**Deliberately simplified / not built**

- **No dedicated job queue.** Sync/enrichment are client-polled batches + cron
  rather than a managed queue (e.g. QStash, Inngest, Supabase Queues). Fine for
  one or a few users; at scale I'd move enrichment behind a real queue with
  per-user concurrency control and dead-lettering.
- **History gap handling.** Gmail keeps only ~1 week of history; if the
  `historyId` watermark expires, incremental sync resets the watermark to "now"
  (a manual re-sync closes any gap) instead of automatically re-backfilling.
- **Plain-text bodies only.** HTML is stripped to text for storage, summaries,
  and embeddings; we don't render rich HTML or handle attachments.
- **Reply, not reply-all.** Sending replies to the primary counterpart; cc/all
  and recipient editing are not exposed in the reply UI.
- **Categorization is single-label** per the required taxonomy (+`other`), and
  computed once at ingest. Labels are stored/surfaced in-app; pushing them back
  to Gmail labels is supported by the granted scope but not wired into the UI.
- **Desktop-first UI.** The three-pane layout targets desktop; it isn't
  responsive for small screens yet.
- **Embeddings best-effort.** If an embedding call fails, the message is still
  stored/summarized/categorized but won't appear in RAG retrieval until
  re-processed.

**What I'd do with more time**

- Managed queue + webhook-driven sync (Gmail `users.watch` + Pub/Sub) instead of
  polling cron.
- Streaming chat responses (token-by-token) and richer citation highlighting.
- Reranking via a purpose-built reranker model and tuned similarity thresholds.
- HTML rendering, attachments, reply-all, and full mobile responsiveness.
- Automated tests around the Gmail parser, MIME builder, chunker, and RAG
  prompt-assembly.
