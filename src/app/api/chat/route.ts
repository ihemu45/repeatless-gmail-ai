import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { answerQuery, type ChatTurn } from "@/lib/ai/rag";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().uuid().optional(),
});

/**
 * POST /api/chat
 * The RAG chat agent. Maintains conversational context via chat_sessions /
 * chat_messages, retrieves over the user's emails, and returns a grounded,
 * source-cited answer.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const supabase = getSupabaseAdmin();
    const { message, sessionId } = Body.parse(await req.json());

    // Resolve (or create) the chat session.
    let chatSessionId = sessionId;
    if (chatSessionId) {
      const { data } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("id", chatSessionId)
        .eq("user_id", session.userId)
        .single();
      if (!data) chatSessionId = undefined;
    }
    if (!chatSessionId) {
      const { data, error } = await supabase
        .from("chat_sessions")
        .insert({ user_id: session.userId, title: message.slice(0, 60) })
        .select("id")
        .single();
      if (error || !data) throw new Error("Could not create chat session");
      chatSessionId = data.id;
    }

    // Load recent history for conversational context.
    const { data: historyRows } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", chatSessionId)
      .order("created_at", { ascending: true })
      .limit(12);
    const history: ChatTurn[] = (historyRows ?? []).map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));

    // Run RAG first: if generation fails we throw before persisting anything,
    // so we never leave an orphaned user turn that would skew later history.
    const result = await answerQuery(session.userId, message, history);

    // Persist both turns together and surface insert failures.
    const { error: insertErr } = await supabase.from("chat_messages").insert([
      {
        session_id: chatSessionId,
        user_id: session.userId,
        role: "user",
        content: message,
      },
      {
        session_id: chatSessionId,
        user_id: session.userId,
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      },
    ]);
    if (insertErr) console.error("Failed to persist chat turn", insertErr);

    return NextResponse.json({
      sessionId: chatSessionId,
      answer: result.answer,
      sources: result.sources,
      retrievedCount: result.retrievedCount,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
