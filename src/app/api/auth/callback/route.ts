import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCode,
  getProfileFromIdToken,
} from "@/lib/google/oauth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { encrypt } from "@/lib/crypto";
import { createSession } from "@/lib/session";
import { env } from "@/lib/env";

/**
 * GET /api/auth/callback
 * Google redirects here with `?code=...&state=...`. We:
 *   1. validate state (CSRF),
 *   2. exchange the code for tokens,
 *   3. verify identity from the id_token,
 *   4. upsert the user and store the refresh token (encrypted),
 *   5. mint our session cookie and send the user into the app.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectWithError(`Google sign-in was cancelled (${oauthError}).`);
  }
  if (!code || !state) {
    return redirectWithError("Missing authorization code.");
  }

  const store = await cookies();
  const expectedState = store.get("rg_oauth_state")?.value;
  store.delete("rg_oauth_state");
  if (!expectedState || expectedState !== state) {
    return redirectWithError("Invalid OAuth state — please try again.");
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.id_token) {
      return redirectWithError("Google did not return an identity token.");
    }
    const profile = await getProfileFromIdToken(tokens.id_token);

    const supabase = getSupabaseAdmin();

    // We only get a refresh_token on first consent (or when prompt=consent).
    // If absent, keep whatever we already had for this user.
    const update: Record<string, unknown> = {
      google_sub: profile.sub,
      email: profile.email,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
      updated_at: new Date().toISOString(),
    };
    if (tokens.refresh_token) {
      update.google_refresh_token = encrypt(tokens.refresh_token);
    }

    let { data: user, error } = await supabase
      .from("users")
      .upsert(update, { onConflict: "google_sub" })
      .select("id, email")
      .single();

    // The table also has a UNIQUE(email). If this email is already bound to a
    // row with a different google_sub (e.g. an account was recreated), the
    // upsert-on-google_sub raises a conflict on the email index instead. Resolve
    // by reconciling the existing email row to this identity.
    if (error) {
      const byEmail = await supabase
        .from("users")
        .update(update)
        .eq("email", profile.email)
        .select("id, email")
        .single();
      user = byEmail.data;
      error = byEmail.error;
    }

    if (error || !user) {
      console.error("User upsert failed", error);
      return redirectWithError("Could not save your account.");
    }

    // Ensure a sync_state row exists.
    await supabase
      .from("sync_state")
      .upsert({ user_id: user.id }, { onConflict: "user_id" });

    await createSession({ userId: user.id, email: user.email });

    return NextResponse.redirect(`${env.appUrl}/inbox`);
  } catch (err) {
    console.error("OAuth callback error", err);
    return redirectWithError("Sign-in failed. Please try again.");
  }
}

function redirectWithError(message: string) {
  const target = new URL(`${env.appUrl}/`);
  target.searchParams.set("error", message);
  return NextResponse.redirect(target);
}
