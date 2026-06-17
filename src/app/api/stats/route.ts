import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errorResponse } from "@/lib/route-helpers";
import { EMAIL_CATEGORIES, type EmailCategory } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/stats — per-category thread counts for the sidebar. */
export async function GET() {
  try {
    const session = await requireSession();
    const supabase = getSupabaseAdmin();

    const counts: Record<string, number> = { all: 0 };
    await Promise.all(
      EMAIL_CATEGORIES.map(async (category: EmailCategory) => {
        let query = supabase
          .from("threads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", session.userId);
        // Threads not yet AI-categorized have a NULL category; bucket them under
        // "other" so per-category counts always sum to "all".
        query =
          category === "other"
            ? query.or("category.eq.other,category.is.null")
            : query.eq("category", category);
        const { count } = await query;
        counts[category] = count ?? 0;
      }),
    );

    const { count: total } = await supabase
      .from("threads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId);
    counts.all = total ?? 0;

    return NextResponse.json({ counts });
  } catch (err) {
    return errorResponse(err);
  }
}
