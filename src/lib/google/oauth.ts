import { OAuth2Client } from "google-auth-library";
import { env } from "../env";
import { getSupabaseAdmin } from "../supabase";
import { decrypt } from "../crypto";
import { ClientError } from "../route-helpers";

/**
 * Google OAuth 2.0 — authorization-code flow with offline access.
 *
 * Scopes (all "restricted"/"sensitive" Gmail scopes require the app to be
 * verified by Google for public use; in "testing" mode you add yourself as a
 * test user — see SETUP.md):
 *   - openid / email / profile  → who the user is
 *   - gmail.modify              → read messages, threads, labels; apply labels
 *   - gmail.send                → send composed emails and replies
 */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
  });
}

/** Build the Google consent URL. `access_type=offline` + `prompt=consent`
 * guarantees we receive a refresh_token (Google only returns it on first
 * consent unless prompt=consent is forced). */
export function buildAuthUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  id_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens as GoogleTokens;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/** Verify the id_token signature/audience and extract the user's identity. */
export async function getProfileFromIdToken(idToken: string): Promise<GoogleProfile> {
  const client = createOAuthClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("id_token missing sub/email");
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}

/**
 * Return a valid Gmail access token for a user, refreshing transparently.
 *
 * The refresh token is stored encrypted in `users.google_refresh_token`. The
 * google-auth-library client refreshes the short-lived access token on demand
 * using that refresh token — we never persist access tokens.
 */
export async function getAccessTokenForUser(userId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("google_refresh_token")
    .eq("id", userId)
    .single();

  if (error || !data?.google_refresh_token) {
    throw new ClientError(
      "Your Google connection has expired — please reconnect Gmail.",
      401,
    );
  }

  const refreshToken = decrypt(data.google_refresh_token);
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  const { token } = await client.getAccessToken();
  if (!token) {
    throw new ClientError(
      "Your Google connection has expired — please reconnect Gmail.",
      401,
    );
  }
  return token;
}
