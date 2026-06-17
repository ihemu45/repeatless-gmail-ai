import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Server-side Supabase client using the service-role key.
 *
 * This bypasses Row Level Security, so it must ONLY ever be imported from
 * server code (route handlers, server actions). Every query in this app is
 * explicitly scoped by `user_id`, which is derived from the signed session
 * cookie — the browser never talks to Supabase directly.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
