import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { draftReply } from "@/lib/ai/compose";
import { errorResponse } from "@/lib/route-helpers";
import type { MessageRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1).max(2000),
});

/**
 * POST /api/reply — draft a thread-aware reply.
 * Builds a transcript from the entire thread so the model understands the full
 * conversation before drafting.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const { threadId, prompt } = Body.parse(await req.json());
    const supabase = getSupabaseAdmin();

    const { data: thread } = await supabase
      .from("threads")
      .select("subject")
      .eq("user_id", session.userId)
      .eq("id", threadId)
      .single();

    const { data: messages } = await supabase
      .from("messages")
      .select("from_name, from_email, internal_date, body_text, snippet, subject")
      .eq("user_id", session.userId)
      .eq("thread_id", threadId)
      .order("internal_date", { ascending: true });

    const msgs = (messages ?? []) as Pick<
      MessageRow,
      "from_name" | "from_email" | "internal_date" | "body_text" | "snippet" | "subject"
    >[];
    if (msgs.length === 0) {
      return NextResponse.json({ error: "Thread has no messages" }, { status: 404 });
    }

    const transcript = msgs
      .map((m) => {
        const from = m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email;
        const when = m.internal_date
          ? new Date(m.internal_date).toLocaleString()
          : "";
        return `From: ${from} | ${when}\n${(m.body_text || m.snippet || "").slice(0, 3000)}`;
      })
      .join("\n\n---\n\n");

    const subject = thread?.subject ?? msgs[0].subject ?? "(no subject)";
    const draft = await draftReply({ prompt, subject, transcript });

    return NextResponse.json({
      body: draft.body,
      subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
