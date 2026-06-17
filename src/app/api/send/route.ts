import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail } from "@/lib/google/send";
import { syncSingleMessage } from "@/lib/google/sync";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    to: z.array(z.string().email()).min(1),
    cc: z.array(z.string().email()).optional(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    mode: z.literal("reply"),
    threadId: z.string().min(1),
    body: z.string().min(1),
  }),
]);

/**
 * POST /api/send — send a composed email or a thread-aware reply.
 * For replies, the threading headers (In-Reply-To / References) and recipient
 * are derived server-side from the thread's latest message.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const supabase = getSupabaseAdmin();
    const input = Body.parse(await req.json());

    const { data: user } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", session.userId)
      .single();
    if (!user) throw new Error("User not found");

    if (input.mode === "new") {
      const result = await sendEmail(session.userId, {
        fromEmail: user.email,
        fromName: user.name,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
      });
      // Reflect the sent message locally so it appears without waiting for sync.
      await syncSingleMessage(session.userId, result.id).catch(() => {});
      return NextResponse.json({ ok: true, ...result });
    }

    // mode === "reply": derive headers from the thread's latest message.
    const { data: messages } = await supabase
      .from("messages")
      .select(
        "from_email, from_name, to_recipients, cc_recipients, internal_date, subject, rfc822_message_id, references_header",
      )
      .eq("user_id", session.userId)
      .eq("thread_id", input.threadId)
      .order("internal_date", { ascending: true });

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const last = messages[messages.length - 1];
    const self = user.email.toLowerCase();

    // Reply headers come from the latest message overall (threading correctness).
    // Recipients come from the latest message NOT authored by us — i.e. reply to
    // whoever last wrote to us, and Cc the rest of that message's participants.
    const lastInbound =
      [...messages].reverse().find(
        (m) => (m.from_email ?? "").toLowerCase() !== self,
      ) ?? last;

    const to = (lastInbound.from_email ?? "").toLowerCase() !== self
      ? [lastInbound.from_email as string]
      : ((lastInbound.to_recipients as { email: string }[]) ?? [])
          .map((c) => c.email)
          .filter((e) => e && e.toLowerCase() !== self)
          .slice(0, 1);

    if (to.length === 0 || !to[0]) {
      return NextResponse.json(
        { error: "Could not determine a reply recipient" },
        { status: 400 },
      );
    }

    // Cc = the inbound message's other recipients, minus us and the To address.
    const ccCandidates = [
      ...((lastInbound.to_recipients as { email: string }[]) ?? []),
      ...((lastInbound.cc_recipients as { email: string }[]) ?? []),
    ].map((c) => c.email?.toLowerCase());
    const toLower = to[0].toLowerCase();
    const cc = [...new Set(ccCandidates)].filter(
      (e) => e && e !== self && e !== toLower,
    ) as string[];

    const baseSubject = last.subject ?? "(no subject)";
    const subject = baseSubject.toLowerCase().startsWith("re:")
      ? baseSubject
      : `Re: ${baseSubject}`;

    const references = [last.references_header, last.rfc822_message_id]
      .filter(Boolean)
      .join(" ");

    const result = await sendEmail(session.userId, {
      fromEmail: user.email,
      fromName: user.name,
      to,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      body: input.body,
      inReplyTo: last.rfc822_message_id,
      references: references || null,
      threadId: input.threadId,
    });

    // Reflect the sent reply locally so the thread updates immediately.
    await syncSingleMessage(session.userId, result.id).catch(() => {});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
