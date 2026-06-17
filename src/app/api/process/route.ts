import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { processPending } from "@/lib/ai/process";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/process
 * Runs one time-bounded AI enrichment batch (summaries, categories, embeddings)
 * over messages that haven't been processed yet. The client polls until
 * `more === false`.
 */
export async function POST() {
  try {
    const session = await requireSession();
    const result = await processPending(session.userId, { budgetMs: 45_000 });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
