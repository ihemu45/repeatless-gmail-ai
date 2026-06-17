# Setup Guide

Step-by-step instructions to get the four required services configured and the
app running. Estimated time: ~20 minutes.

---

## 0. Prerequisites

- Node.js 20+ and npm
- A Google account (for Gmail + Gemini)
- A Supabase account
- An NVIDIA account (for NIM)

```bash
npm install
cp .env.example .env.local
```

Keep `.env.local` open; you'll fill it in as you go.

Generate the two security secrets now:

```bash
openssl rand -base64 32   # paste as SESSION_SECRET
openssl rand -base64 32   # paste as ENCRYPTION_KEY  (must be 32 bytes / base64)
```

---

## 1. Supabase (Postgres + pgvector)

1. Create a new project at <https://supabase.com/dashboard>.
2. **SQL Editor → New query** → paste the entire contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) →
   **Run**. This creates all tables, indexes, the `match_email_chunks` function,
   and enables `pgvector`.
3. **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL` (and `NEXT_PUBLIC_SUPABASE_URL`)
   - **`service_role` key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only, keep secret)
   - **`anon` key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional)

---

## 2. Google Cloud — OAuth 2.0 + Gmail API

1. Go to <https://console.cloud.google.com/> and create (or select) a project.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill app name / support email.
   - **Scopes:** you can leave default; the app requests `gmail.modify`,
     `gmail.send`, `openid`, `email`, `profile` at runtime.
   - **Test users:** add the Gmail address(es) you'll log in with. (While the
     app is in "Testing", only listed test users can authorize the sensitive
     Gmail scopes — no Google verification needed for the assessment.)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add
     `http://localhost:3000/api/auth/callback`
     (and your production `https://<app>.vercel.app/api/auth/callback` later).
   - Create, then copy:
     - **Client ID** → `GOOGLE_CLIENT_ID`
     - **Client secret** → `GOOGLE_CLIENT_SECRET`

> The redirect URI must exactly match `${APP_URL}/api/auth/callback`.

---

## 3. Google Gemini (primary AI model)

1. Open <https://aistudio.google.com/apikey> and **Create API key**.
2. Copy it → `GEMINI_API_KEY`.
3. Leave the defaults: `GEMINI_MODEL=gemini-2.0-flash`,
   `GEMINI_EMBED_MODEL=text-embedding-004`.

---

## 4. NVIDIA NIM (secondary AI model)

1. Go to <https://build.nvidia.com>, sign in, and pick a model (default:
   **`meta/llama-3.1-8b-instruct`**).
2. Generate an API key (free tier) → `NVIDIA_NIM_API_KEY`.
3. Leave `NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1` and
   `NVIDIA_NIM_MODEL=meta/llama-3.1-8b-instruct` (any NIM chat model works —
   just update the model id).

---

## 5. Run it

```bash
npm run dev          # http://localhost:3000
```

1. Click **Connect Gmail** and authorize (use a test-user account).
2. Click **Sync inbox** — this imports your mail, then analyzes it (summaries,
   categories, embeddings). Large inboxes sync in batches; progress shows in the
   sidebar.
3. Explore: read threads with summaries, filter by category, **Compose** /
   **reply** with AI, open **Ask AI** for the RAG chat, and **News digest** for
   deduped newsletters.

---

## 6. Deploy to Vercel

1. Push to GitHub; import the repo in Vercel.
2. Add every variable from `.env.example` in **Project → Settings → Environment
   Variables**. Set `APP_URL` to your Vercel URL.
3. Add `https://<your-app>.vercel.app/api/auth/callback` as an authorized
   redirect URI in Google Cloud (step 2.4).
4. Set `CRON_SECRET` (Vercel sends it automatically to the cron endpoint).
5. Deploy.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` | The Google redirect URI must exactly equal `${APP_URL}/api/auth/callback`. |
| `access_denied` on consent | Add your Gmail address as a **Test user** on the OAuth consent screen. |
| `ENCRYPTION_KEY must decode to exactly 32 bytes` | Regenerate with `openssl rand -base64 32`. |
| Vector search errors | Re-run `0001_init.sql`; ensure the `vector` extension is enabled. |
| Sync seems stuck | It runs in time-bounded batches — keep the tab open; the sidebar shows progress. |
| NIM 401/404 | Check `NVIDIA_NIM_API_KEY` and that `NVIDIA_NIM_MODEL` is a model your key can access. |
