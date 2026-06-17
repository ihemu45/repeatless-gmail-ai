import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthUrl } from "@/lib/google/oauth";

/**
 * GET /api/auth/google
 * Kicks off the OAuth flow. We generate a random `state` value, stash it in a
 * short-lived cookie, and include it in the consent URL to defend against CSRF
 * on the callback.
 */
export async function GET() {
  const state = randomBytes(16).toString("hex");

  const store = await cookies();
  store.set("rg_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
