import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getNewsDigest } from "@/lib/ai/news";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/news?days=4 — deduplicated newsletter digest. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? "4")));
    const digest = await getNewsDigest(session.userId, days);
    return NextResponse.json(digest);
  } catch (err) {
    return errorResponse(err);
  }
}
