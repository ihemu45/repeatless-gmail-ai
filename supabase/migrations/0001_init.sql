-- ============================================================================
--  Repeatless Gmail AI — initial schema
--  Postgres + pgvector (Supabase). Run this in the Supabase SQL Editor, or via
--  `supabase db push`. Idempotent where practical.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
--  Enums
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_category') then
    create type email_category as enum (
      'newsletters', 'job', 'finance', 'notifications', 'personal', 'work', 'other'
    );
  end if;
end$$;

-- ----------------------------------------------------------------------------
--  Users  — one row per Google account that has authenticated.
--  The Google refresh token is stored AES-256-GCM encrypted (see lib/crypto.ts).
-- ----------------------------------------------------------------------------
create table if not exists users (
  id                    uuid primary key default gen_random_uuid(),
  google_sub            text unique not null,          -- Google's stable subject id
  email                 text unique not null,
  name                  text,
  picture               text,
  google_refresh_token  text,                           -- encrypted at rest
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Sync state  — per-user watermark for the Gmail sync engine.
--  `last_history_id` powers incremental sync (Gmail History API).
--  `next_page_token` lets the initial backfill resume across invocations
--  (important on serverless where each request is time-bounded).
-- ----------------------------------------------------------------------------
create table if not exists sync_state (
  user_id           uuid primary key references users(id) on delete cascade,
  status            text not null default 'idle',       -- idle | syncing | error
  last_history_id   text,
  next_page_token   text,
  initial_sync_done boolean not null default false,
  total_synced      int not null default 0,
  last_synced_at    timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Threads  — first-class conversation objects. Every feature operates on
--  threads, not just isolated messages.
-- ----------------------------------------------------------------------------
create table if not exists threads (
  id                 text not null,                     -- Gmail thread id
  user_id            uuid not null references users(id) on delete cascade,
  subject            text,
  snippet            text,
  participants       jsonb not null default '[]'::jsonb,
  message_count      int not null default 0,
  last_message_at    timestamptz,
  category           email_category,
  summary            text,
  summary_updated_at timestamptz,
  summary_msg_count  int,                                -- message_count when summary was generated
  history_id         text,
  created_at         timestamptz not null default now(),
  primary key (user_id, id)
);

-- ----------------------------------------------------------------------------
--  Messages  — individual emails. Thread headers (Message-ID, In-Reply-To,
--  References) are preserved so AI-generated replies thread correctly in Gmail.
-- ----------------------------------------------------------------------------
create table if not exists messages (
  id                text not null,                      -- Gmail message id
  thread_id         text not null,
  user_id           uuid not null references users(id) on delete cascade,
  rfc822_message_id text,                               -- "Message-ID" header
  in_reply_to       text,                               -- "In-Reply-To" header
  references_header text,                               -- "References" header
  from_name         text,
  from_email        text,
  to_recipients     jsonb not null default '[]'::jsonb,
  cc_recipients     jsonb not null default '[]'::jsonb,
  subject           text,
  snippet           text,
  body_text         text,
  label_ids         jsonb not null default '[]'::jsonb,
  is_unread         boolean not null default false,
  internal_date     timestamptz,
  category          email_category,
  summary           text,
  embedded          boolean not null default false,     -- chunk embeddings generated?
  created_at        timestamptz not null default now(),
  primary key (user_id, id)
);

-- ----------------------------------------------------------------------------
--  Email chunks  — the RAG knowledge base. Long email bodies are split into
--  overlapping chunks and embedded with Gemini text-embedding-004 (768 dims).
--  Source metadata is denormalised onto each chunk so retrieval can attribute
--  an answer to a specific sender / subject / date without extra joins.
-- ----------------------------------------------------------------------------
create table if not exists email_chunks (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references users(id) on delete cascade,
  message_id    text not null,
  thread_id     text not null,
  chunk_index   int not null,
  content       text not null,
  from_email    text,
  from_name     text,
  subject       text,
  message_date  timestamptz,
  embedding     vector(768),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Chat  — the AI agent's conversation history (for conversational context).
-- ----------------------------------------------------------------------------
create table if not exists chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null,                             -- 'user' | 'assistant'
  content    text not null,
  sources    jsonb not null default '[]'::jsonb,        -- attribution payload
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  News items  — extracted from newsletter emails for semantic dedup (bonus).
-- ----------------------------------------------------------------------------
create table if not exists news_items (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references users(id) on delete cascade,
  message_id  text not null,
  title       text not null,
  summary     text,
  url         text,
  source      text,
  item_date   timestamptz,
  embedding   vector(768),
  cluster_id  text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_messages_user_date  on messages (user_id, internal_date desc);
create index if not exists idx_messages_thread      on messages (user_id, thread_id);
create index if not exists idx_messages_category    on messages (user_id, category);
create index if not exists idx_messages_unembedded  on messages (user_id) where embedded = false;

create index if not exists idx_threads_user_date    on threads (user_id, last_message_at desc);
create index if not exists idx_threads_category      on threads (user_id, category);

create index if not exists idx_chunks_user          on email_chunks (user_id);
create index if not exists idx_chunks_message       on email_chunks (message_id);
-- Approximate nearest-neighbour index for fast cosine similarity search.
create index if not exists idx_chunks_embedding     on email_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_news_user            on news_items (user_id, item_date desc);
create index if not exists idx_news_embedding       on news_items using hnsw (embedding vector_cosine_ops);

create index if not exists idx_chat_messages_session on chat_messages (session_id, created_at);

-- ----------------------------------------------------------------------------
--  RAG retrieval function — cosine similarity search scoped to one user.
--  Called from the app via supabase.rpc('match_email_chunks', ...).
-- ----------------------------------------------------------------------------
create or replace function match_email_chunks (
  query_embedding      vector(768),
  match_user_id        uuid,
  match_count          int default 12,
  similarity_threshold float default 0.0
)
returns table (
  id           bigint,
  message_id   text,
  thread_id    text,
  content      text,
  from_email   text,
  from_name    text,
  subject      text,
  message_date timestamptz,
  similarity   float
)
language sql stable
as $$
  select
    c.id, c.message_id, c.thread_id, c.content,
    c.from_email, c.from_name, c.subject, c.message_date,
    1 - (c.embedding <=> query_embedding) as similarity
  from email_chunks c
  where c.user_id = match_user_id
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ----------------------------------------------------------------------------
--  Row Level Security
--  The app talks to Postgres only through the service-role key from trusted
--  server code, and every query is explicitly scoped by user_id. We still
--  enable RLS as defence-in-depth: it denies all access to the anon/public
--  role by default (no policies are granted to it). The service role bypasses
--  RLS, so application queries are unaffected.
-- ----------------------------------------------------------------------------
alter table users         enable row level security;
alter table sync_state    enable row level security;
alter table threads       enable row level security;
alter table messages      enable row level security;
alter table email_chunks  enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table news_items    enable row level security;
