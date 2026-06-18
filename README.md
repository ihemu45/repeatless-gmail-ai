# 📬 Repeatless Mail — AI Gmail Intelligence Platform

A web app that connects to your Gmail, syncs and understands your inbox, and
gives you an AI assistant that summarizes, categorizes, drafts, and answers
questions grounded **only** in your own emails — with sources cited.

> Built for the Repeatless "AI Automation Executive" technical assessment.
> Design rationale lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).
> Step-by-step credential setup lives in [`SETUP.md`](SETUP.md).

---

## Features

- **Gmail integration** — OAuth 2.0 (Gmail API, not IMAP/SMTP), full inbox sync
  (messages, threads, labels, metadata), resumable pagination for large inboxes,
  429/backoff rate-limit handling, and incremental sync via the History API.
- **Summarization** — per-message gists and context-aware **thread-level**
  summaries (hierarchical for long threads).
- **Compose & reply** — write a full email from a one-line prompt; reply with
  **full thread context** and correct `In-Reply-To`/`References` headers so it
  threads in Gmail.
- **Threads as first-class** — every feature operates on threads, not isolated
  messages.
- **Categorization** — auto-labels into Newsletters · Job/Recruitment · Finance
  · Notifications · Personal · Work (+ Other), stored in Supabase and shown in
  the UI.
- **AI chat agent** — RAG over your emails: cross-email synthesis, conversational
  follow-ups, inline source citations, and a hard no-hallucination guardrail.
- **(Bonus) Newsletter dedup** — extracts news items across newsletters and
  merges duplicate stories by semantic similarity, attributing each to its
  sources.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend & Backend | **Next.js 15** (App Router, TypeScript), Tailwind CSS v4 |
| Database | **Supabase** — Postgres + **pgvector** |
| Email | **Gmail API** over OAuth 2.0 (`google-auth-library`) |
| Primary AI | **Google Gemini** (`gemini-2.0-flash` + `text-embedding-004`) |
| Secondary AI | **NVIDIA NIM** (`meta/llama-3.1-8b-instruct`) for classification + reranking |
| Auth / security | Signed-JWT session (`jose`), AES-256-GCM token encryption |
| Deploy | Vercel (+ Vercel Cron for incremental sync) |

---

## Quick start (local)

> You'll need accounts/keys for Google Cloud (OAuth + Gmail API), Supabase,
> Gemini, and NVIDIA NIM. **[`SETUP.md`](SETUP.md) walks through each one.**

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env.local
#   …then fill in .env.local (see SETUP.md). Generate secrets with:
#   openssl rand -base64 32   # SESSION_SECRET and ENCRYPTION_KEY

# 3. Create the database
#   Open the Supabase SQL Editor and run the contents of
#   supabase/migrations/0001_init.sql

# 4. Run
npm run dev
#   → http://localhost:3000
```

Then: open the app → **Connect Gmail** → **Sync inbox** (imports + analyzes your
mail) → browse, summarize, categorize, compose/reply, and **Ask AI**.

## Environment variables

All variables are documented inline in [`.env.example`](.env.example). Summary:

| Variable | What it is |
|---|---|
| `APP_URL` | Base URL (e.g. `http://localhost:3000`). Used to build the OAuth redirect. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase project + server-only key. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_EMBED_MODEL` | Gemini generation + embedding. |
| `NVIDIA_NIM_API_KEY` / `NVIDIA_NIM_BASE_URL` / `NVIDIA_NIM_MODEL` | NVIDIA NIM (secondary model). |
| `SESSION_SECRET` | Signs the session JWT. |
| `ENCRYPTION_KEY` | 32-byte base64 key; encrypts Google refresh tokens at rest. |
| `CRON_SECRET` | Protects the Vercel Cron sync endpoint. |

No real secrets are committed; `.env.local` is git-ignored.

## Project structure

```
repeatless-gmail-ai/
├── ARCHITECTURE.md            # design document (required deliverable)
├── SETUP.md                   # step-by-step credential setup
├── vercel.json                # Vercel Cron (incremental sync)
├── supabase/migrations/
│   └── 0001_init.sql          # full schema: tables, indexes, RPC, RLS
└── src/
    ├── app/
    │   ├── page.tsx           # landing / Connect Gmail
    │   ├── inbox/page.tsx     # authenticated app shell
    │   └── api/               # route handlers (see below)
    │       ├── auth/          # google · callback · logout · me
    │       ├── sync · process · sync/cron
    │       ├── threads · threads/[id] · stats
    │       ├── compose · reply · send
    │       └── chat · news
    ├── components/            # InboxApp, Sidebar, ThreadList, ThreadView,
    │                          # ChatPanel, ComposeModal, NewsModal, ui
    └── lib/
        ├── env.ts             # validated env access
        ├── supabase.ts        # server (service-role) client
        ├── session.ts         # signed-JWT session
        ├── crypto.ts          # AES-256-GCM for refresh tokens
        ├── ratelimit.ts       # concurrency limiter + backoff
        ├── route-helpers.ts   # consistent API error responses
        ├── types.ts           # shared domain types
        ├── client.ts          # browser API client
        ├── google/            # oauth · gmail · sync · send
        └── ai/                # gemini · nim · summarize · categorize ·
                               # chunk · process · rag · compose · news
```

### How sync works (mental model)

1. **`/api/sync`** ingests raw mail in resumable, time-bounded batches
   (initial backfill → incremental via History API).
2. **`/api/process`** enriches unprocessed messages: summary (Gemini) +
   category (NIM) + chunk embeddings (Gemini) → `email_chunks`.
3. The UI polls both to completion on **Sync inbox**; **Vercel Cron** runs them
   hourly thereafter.

## Deployment (Vercel)

1. Push this repo to GitHub and import it in Vercel.
2. Add all env vars from `.env.example` in the Vercel project settings. Set
   `APP_URL` to your Vercel URL and add `https://<your-app>.vercel.app/api/auth/callback`
   as an authorized redirect URI in Google Cloud.
3. Run `supabase/migrations/0001_init.sql` against your Supabase project.
4. Deploy. `vercel.json` registers the hourly cron at `/api/sync/cron`
   (protected by `CRON_SECRET`).

> **Cron frequency note:** `vercel.json` is set to once daily (`0 9 * * *`)
> because Vercel's Hobby plan only allows daily cron jobs. On Pro you can run it
> more frequently (e.g. hourly `0 * * * *`); you can also trigger sync any time
> from the UI.

## Notes & limitations

See [`ARCHITECTURE.md` §6](ARCHITECTURE.md#6-trade-offs--limitations). In short:
no dedicated job queue (resumable batches + cron instead), plain-text bodies,
reply (not reply-all), desktop-first UI.

## Built with AI tooling

This project was implemented with AI coding assistance, as permitted by the
assignment. Every module is intentionally small and commented so each decision
can be explained.
