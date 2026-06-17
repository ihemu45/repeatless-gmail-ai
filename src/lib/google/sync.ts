import { getAccessTokenForUser } from "./oauth";
import {
  getProfile,
  listMessageIds,
  getMessage,
  listHistory,
  parseMessage,
  GmailApiError,
  type ParsedMessage,
} from "./gmail";
import { getSupabaseAdmin } from "../supabase";
import { createLimiter } from "../ratelimit";
import type { Contact } from "../types";

/**
 * Gmail sync engine.
 *
 * Two modes, chosen automatically from `sync_state`:
 *
 *  • Initial backfill  — paginate `messages.list`, fan out `messages.get`
 *    (concurrency-capped), upsert messages + threads. Resumable: the page
 *    token is persisted after every page so a serverless invocation can stop
 *    at its time budget and the next call picks up exactly where it left off.
 *
 *  • Incremental       — once the backfill is complete we only pull changes
 *    since the stored `historyId` via `history.list` (messageAdded/Deleted).
 *
 * Each call is bounded by `budgetMs` so it fits comfortably inside a serverless
 * function timeout; the caller polls until `more === false`.
 */

const PAGE_SIZE = 100;
const FETCH_CONCURRENCY = 8;

export interface SyncResult {
  mode: "initial" | "incremental";
  fetched: number;
  initialSyncDone: boolean;
  more: boolean; // true => caller should invoke runSync again to continue
}

export async function runSync(userId: string, budgetMs = 45_000): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();
  const accessToken = await getAccessTokenForUser(userId);
  const deadline = Date.now() + budgetMs;

  const { data: state } = await supabase
    .from("sync_state")
    .select("*")
    .eq("user_id", userId)
    .single();

  await supabase
    .from("sync_state")
    .update({ status: "syncing", last_error: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  try {
    const result = state?.initial_sync_done
      ? await incrementalSync(userId, accessToken, state.last_history_id, deadline)
      : await initialSync(userId, accessToken, state?.next_page_token ?? null, deadline);

    await supabase
      .from("sync_state")
      .update({
        status: result.more ? "syncing" : "idle",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return result;
  } catch (err) {
    await supabase
      .from("sync_state")
      .update({
        status: "error",
        last_error: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    throw err;
  }
}

// ----------------------------------------------------------------------------
//  Initial backfill
// ----------------------------------------------------------------------------
async function initialSync(
  userId: string,
  accessToken: string,
  startPageToken: string | null,
  deadline: number,
): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();
  const limit = createLimiter(FETCH_CONCURRENCY);
  let pageToken = startPageToken ?? undefined;
  let fetched = 0;

  do {
    const list = await listMessageIds(accessToken, {
      pageToken,
      maxResults: PAGE_SIZE,
    });
    const ids = list.messages ?? [];

    if (ids.length > 0) {
      const parsed = await Promise.all(
        ids.map((m) =>
          limit(async () => parseMessage(await getMessage(accessToken, m.id, "full"))),
        ),
      );
      await storeMessages(userId, parsed);
      fetched += parsed.length;
    }

    pageToken = list.nextPageToken;

    // Persist progress so we can resume after a timeout.
    await supabase
      .from("sync_state")
      .update({ next_page_token: pageToken ?? null })
      .eq("user_id", userId);

    await refreshTotal(userId);

    if (!pageToken) {
      // Backfill complete — record the current historyId as the incremental
      // watermark.
      const profile = await getProfile(accessToken);
      await supabase
        .from("sync_state")
        .update({
          initial_sync_done: true,
          next_page_token: null,
          last_history_id: profile.historyId,
        })
        .eq("user_id", userId);
      return { mode: "initial", fetched, initialSyncDone: true, more: false };
    }
  } while (Date.now() < deadline);

  return { mode: "initial", fetched, initialSyncDone: false, more: true };
}

// ----------------------------------------------------------------------------
//  Incremental sync
// ----------------------------------------------------------------------------
async function incrementalSync(
  userId: string,
  accessToken: string,
  startHistoryId: string | null,
  deadline: number,
): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();
  const limit = createLimiter(FETCH_CONCURRENCY);

  if (!startHistoryId) {
    const profile = await getProfile(accessToken);
    await supabase
      .from("sync_state")
      .update({ last_history_id: profile.historyId })
      .eq("user_id", userId);
    return { mode: "incremental", fetched: 0, initialSyncDone: true, more: false };
  }

  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  let fetched = 0;
  let completed = false;
  const addedIds = new Set<string>();
  const deletedIds = new Set<string>();
  // messageId -> label deltas to apply to already-stored messages.
  const labelDeltas = new Map<string, { add: Set<string>; remove: Set<string> }>();
  const deltaFor = (id: string) => {
    let d = labelDeltas.get(id);
    if (!d) {
      d = { add: new Set(), remove: new Set() };
      labelDeltas.set(id, d);
    }
    return d;
  };

  try {
    do {
      const hist = await listHistory(accessToken, startHistoryId, pageToken);
      for (const h of hist.history ?? []) {
        h.messagesAdded?.forEach((m) => addedIds.add(m.message.id));
        h.messagesDeleted?.forEach((m) => deletedIds.add(m.message.id));
        h.labelsAdded?.forEach((l) =>
          l.labelIds.forEach((id) => deltaFor(l.message.id).add.add(id)),
        );
        h.labelsRemoved?.forEach((l) =>
          l.labelIds.forEach((id) => deltaFor(l.message.id).remove.add(id)),
        );
      }
      if (hist.historyId) latestHistoryId = hist.historyId;
      pageToken = hist.nextPageToken;
    } while (pageToken && Date.now() < deadline);
    // We only fully drained history if there is no remaining page token.
    completed = !pageToken;
  } catch (err) {
    // A 404 means our historyId has expired (Gmail only keeps ~1 week of
    // history). Reset the watermark to "now"; a manual full re-sync can be
    // triggered if needed. Documented as a limitation in ARCHITECTURE.md.
    if (err instanceof GmailApiError && err.status === 404) {
      const profile = await getProfile(accessToken);
      await supabase
        .from("sync_state")
        .update({ last_history_id: profile.historyId })
        .eq("user_id", userId);
      return { mode: "incremental", fetched: 0, initialSyncDone: true, more: false };
    }
    throw err;
  }

  // Apply deletions (idempotent).
  if (deletedIds.size > 0) {
    await supabase
      .from("messages")
      .delete()
      .eq("user_id", userId)
      .in("id", [...deletedIds]);
  }

  // Fetch + store new messages.
  const toFetch = [...addedIds].filter((id) => !deletedIds.has(id));
  if (toFetch.length > 0) {
    const parsed = await Promise.all(
      toFetch.map((id) =>
        limit(async () => parseMessage(await getMessage(accessToken, id, "full"))),
      ),
    );
    await storeMessages(userId, parsed);
    fetched = parsed.length;
    await refreshTotal(userId);
  }

  // Apply label/read-state changes to already-stored messages. (Newly fetched
  // messages already carry fresh labels, so skip them.)
  await applyLabelDeltas(userId, labelDeltas, new Set(toFetch), deletedIds);

  // CRITICAL: only advance the watermark if we drained ALL history pages. If we
  // stopped at the time budget, keep the old watermark and signal the caller to
  // resume — otherwise the skipped pages' changes would be lost forever.
  if (completed) {
    await supabase
      .from("sync_state")
      .update({ last_history_id: latestHistoryId })
      .eq("user_id", userId);
  }

  return { mode: "incremental", fetched, initialSyncDone: true, more: !completed };
}

/** Apply Gmail label additions/removals to messages already in our store. */
async function applyLabelDeltas(
  userId: string,
  deltas: Map<string, { add: Set<string>; remove: Set<string> }>,
  skip: Set<string>,
  deleted: Set<string>,
): Promise<void> {
  const ids = [...deltas.keys()].filter((id) => !skip.has(id) && !deleted.has(id));
  if (ids.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { data: rows } = await supabase
    .from("messages")
    .select("id, label_ids")
    .eq("user_id", userId)
    .in("id", ids);
  if (!rows) return;

  await Promise.all(
    rows.map((row) => {
      const delta = deltas.get(row.id)!;
      const next = new Set<string>((row.label_ids as string[]) ?? []);
      delta.add.forEach((l) => next.add(l));
      delta.remove.forEach((l) => next.delete(l));
      const labelArr = [...next];
      return supabase
        .from("messages")
        .update({ label_ids: labelArr, is_unread: labelArr.includes("UNREAD") })
        .eq("user_id", userId)
        .eq("id", row.id);
    }),
  );
}

/**
 * Fetch a single message by id and store it — used right after sending so a
 * sent message/reply appears locally without waiting for the next sync cycle.
 */
export async function syncSingleMessage(
  userId: string,
  messageId: string,
): Promise<void> {
  const accessToken = await getAccessTokenForUser(userId);
  const parsed = parseMessage(await getMessage(accessToken, messageId, "full"));
  await storeMessages(userId, parsed ? [parsed] : []);
  await refreshTotal(userId);
}

// ----------------------------------------------------------------------------
//  Persistence helpers
// ----------------------------------------------------------------------------
async function storeMessages(userId: string, parsed: ParsedMessage[]): Promise<void> {
  if (parsed.length === 0) return;
  const supabase = getSupabaseAdmin();

  const rows = parsed.map((p) => ({
    id: p.id,
    thread_id: p.threadId,
    user_id: userId,
    rfc822_message_id: p.rfc822MessageId || null,
    in_reply_to: p.inReplyTo || null,
    references_header: p.references || null,
    from_name: p.fromName || null,
    from_email: p.fromEmail || null,
    to_recipients: p.to,
    cc_recipients: p.cc,
    subject: p.subject || null,
    snippet: p.snippet || null,
    body_text: p.bodyText || null,
    label_ids: p.labelIds,
    is_unread: p.isUnread,
    internal_date: p.internalDate,
  }));

  // Don't clobber AI enrichment (summary/category/embedded) on re-sync: only
  // insert rows that are new. ignoreDuplicates avoids overwriting existing
  // enriched rows; label/read-state refresh is handled by incremental events.
  const { error } = await supabase
    .from("messages")
    .upsert(rows, { onConflict: "user_id,id", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to store messages: ${error.message}`);

  await recomputeThreads(userId, [...new Set(parsed.map((p) => p.threadId))]);
}

/** Rebuild thread aggregates (subject, participants, counts, last activity)
 * from the messages currently stored for the given threads. */
async function recomputeThreads(userId: string, threadIds: string[]): Promise<void> {
  if (threadIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { data: msgs, error } = await supabase
    .from("messages")
    .select(
      "thread_id, subject, snippet, from_name, from_email, to_recipients, cc_recipients, internal_date",
    )
    .eq("user_id", userId)
    .in("thread_id", threadIds);
  if (error || !msgs) return;

  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const arr = byThread.get(m.thread_id) ?? [];
    arr.push(m);
    byThread.set(m.thread_id, arr);
  }

  const threadRows = [...byThread.entries()].map(([threadId, items]) => {
    const sorted = [...items].sort(
      (a, b) =>
        new Date(a.internal_date ?? 0).getTime() -
        new Date(b.internal_date ?? 0).getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const participants = new Map<string, Contact>();
    for (const m of items) {
      if (m.from_email) {
        participants.set(m.from_email, {
          name: m.from_name ?? "",
          email: m.from_email,
        });
      }
      for (const c of [
        ...((m.to_recipients as Contact[]) ?? []),
        ...((m.cc_recipients as Contact[]) ?? []),
      ]) {
        if (c.email && !participants.has(c.email)) participants.set(c.email, c);
      }
    }

    return {
      id: threadId,
      user_id: userId,
      subject: first?.subject ?? last?.subject ?? null,
      snippet: last?.snippet ?? null,
      participants: [...participants.values()],
      message_count: items.length,
      last_message_at: last?.internal_date ?? null,
    };
  });

  const { error: upsertErr } = await supabase
    .from("threads")
    .upsert(threadRows, { onConflict: "user_id,id" });
  if (upsertErr) throw new Error(`Failed to upsert threads: ${upsertErr.message}`);
}

/** Keep `total_synced` accurate (and idempotent under retries) by counting rows. */
async function refreshTotal(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  await supabase
    .from("sync_state")
    .update({ total_synced: count ?? 0 })
    .eq("user_id", userId);
}
