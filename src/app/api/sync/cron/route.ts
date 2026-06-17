import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSync } from "@/lib/google/sync";
import { processPending } from "@/lib/ai/process";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/sync/cron
 * Invoked by Vercel Cron (see vercel.json). Pulls incremental changes for every
 * user whose initial backfill is complete, then enriches anything new. Protected
 * by CRON_SECRET (Vercel sends it as a Bearer token automatically).
 */
export async function GET(req: NextRequest) {
  // Fail closed: require a valid Bearer token regardless of how env is set.
  // (env.cronSecret throws if CRON_SECRET is unset, so the route never runs
  // unauthenticated.) Vercel Cron sends this header automatically.
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: users } = await supabase
    .from("sync_state")
    .select("user_id")
    .eq("initial_sync_done", true);

  let synced = 0;
  for (const u of users ?? []) {
    try {
      // Drain any pending incremental pages (resumable) within a small budget,
      // then enrich. The guard caps loops so one user can't starve the others.
      let guard = 0;
      let more = true;
      while (more && guard++ < 5) {
        more = (await runSync(u.user_id, 12_000)).more;
      }
      await processPending(u.user_id, { budgetMs: 15_000 });
      synced++;
    } catch (err) {
      console.error(`Cron sync failed for ${u.user_id}`, err);
    }
  }

  return NextResponse.json({ ok: true, users: users?.length ?? 0, synced });
}
