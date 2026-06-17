import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

/** GET /api/auth/me — current user + sync status, or 401. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: user }, { data: sync }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, name, picture")
      .eq("id", session.userId)
      .single(),
    supabase
      .from("sync_state")
      .select("status, initial_sync_done, total_synced, last_synced_at, last_error")
      .eq("user_id", session.userId)
      .single(),
  ]);

  return NextResponse.json({ user, sync });
}
