import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { runSync } from "@/lib/google/sync";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/sync
 * Runs one time-bounded sync batch for the current user. The client calls this
 * repeatedly while `more === true` to drive the initial backfill to completion,
 * then occasionally to pull incremental changes.
 */
export async function POST() {
  try {
    const session = await requireSession();
    const result = await runSync(session.userId, 45_000);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
