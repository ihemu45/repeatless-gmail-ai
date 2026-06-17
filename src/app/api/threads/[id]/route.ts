import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { summarizeThread } from "@/lib/ai/summarize";
import { errorResponse } from "@/lib/route-helpers";
import type { MessageRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/threads/:id
 * Returns a thread with all its messages (oldest → newest). Lazily generates a
 * thread-level summary the first time a thread is opened (or after new replies),
 * understanding each message in the context of the whole conversation.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: thread, error: threadErr } = await supabase
      .from("threads")
      .select("*")
      .eq("user_id", session.userId)
      .eq("id", id)
      .single();
    if (threadErr || !thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const { data: messages } = await supabase
      .from("messages")
      .select("*")
      .eq("user_id", session.userId)
      .eq("thread_id", id)
      .order("internal_date", { ascending: true });

    const msgs = (messages ?? []) as MessageRow[];

    // (Re)generate the thread summary if missing, or if new messages have
    // arrived since it was last generated. We compare message COUNT (same unit
    // both sides) rather than wall-clock-vs-email-date, which is unreliable.
    const stale =
      !thread.summary || (thread.summary_msg_count ?? -1) !== msgs.length;

    let summary = thread.summary as string | null;
    if (stale && msgs.length > 0) {
      try {
        summary = await summarizeThread({
          subject: thread.subject ?? "(no subject)",
          messages: msgs.map((m) => ({
            from: m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email ?? "",
            date: m.internal_date,
            body: m.body_text ?? m.snippet ?? "",
            perMessageSummary: m.summary,
          })),
        });
        await supabase
          .from("threads")
          .update({
            summary,
            summary_updated_at: new Date().toISOString(),
            summary_msg_count: msgs.length,
          })
          .eq("user_id", session.userId)
          .eq("id", id);
      } catch (err) {
        console.error("Thread summary failed", err);
      }
    }

    return NextResponse.json({ thread: { ...thread, summary }, messages: msgs });
  } catch (err) {
    return errorResponse(err);
  }
}
