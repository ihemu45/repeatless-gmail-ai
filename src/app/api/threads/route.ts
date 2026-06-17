import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errorResponse } from "@/lib/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/threads?category=&q=&page=
 * Paginated thread list for the inbox, newest activity first, with optional
 * category filter and subject search.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q")?.trim();
    const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
    const pageSize = 25;

    let query = supabase
      .from("threads")
      .select(
        "id, subject, snippet, participants, message_count, last_message_at, category, summary",
      )
      .eq("user_id", session.userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (category && category !== "all") {
      // "other" also surfaces not-yet-categorized (NULL) threads, matching stats.
      query =
        category === "other"
          ? query.or("category.eq.other,category.is.null")
          : query.eq("category", category);
    }
    if (q) query = query.ilike("subject", `%${q}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ threads: data ?? [], page, pageSize });
  } catch (err) {
    return errorResponse(err);
  }
}
