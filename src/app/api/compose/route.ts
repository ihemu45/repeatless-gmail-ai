import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { draftNewEmail } from "@/lib/ai/compose";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ prompt: z.string().min(1).max(2000) });

/** POST /api/compose — draft a new email from a short instruction. */
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const { prompt } = Body.parse(await req.json());
    const draft = await draftNewEmail(prompt);
    return NextResponse.json(draft);
  } catch (err) {
    return errorResponse(err);
  }
}
