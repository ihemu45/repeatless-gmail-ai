import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/inbox");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-xl animate-rise">
        <div className="card p-10">
          <div className="mb-6 flex items-center gap-3.5">
            <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-xl shadow-[0_8px_20px_-8px_rgba(79,70,229,.6)]">
              📬
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Repeatless Mail</h1>
              <p className="text-sm text-[var(--muted)]">AI Gmail Intelligence Platform</p>
            </div>
          </div>

          <p className="mb-8 text-[15px] leading-relaxed text-gray-600">
            Connect your Gmail to sync your inbox, auto-summarize and categorize every
            thread, draft replies from a one-line prompt, and ask an AI assistant questions
            answered{" "}
            <span className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text font-semibold text-transparent">
              only
            </span>{" "}
            from your own emails — with sources cited.
          </p>

          {error && (
            <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <a
            href="/api/auth/google"
            className="btn-primary flex w-full items-center justify-center gap-3 rounded-xl px-5 py-3.5 font-medium"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#fff"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
                opacity=".9"
              />
              <path
                fill="#fff"
                d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                opacity=".7"
              />
              <path
                fill="#fff"
                d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
                opacity=".5"
              />
              <path
                fill="#fff"
                d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.3 9.14 4.75 12 4.75Z"
              />
            </svg>
            Connect Gmail
          </a>

          <p className="mt-4 text-center text-xs text-[var(--muted)]">
            We request Gmail access via Google OAuth 2.0. Your refresh token is encrypted at
            rest and never leaves the server.
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          Built for the Repeatless AI Automation assessment · Next.js · Supabase · Gemini ·
          NVIDIA NIM
        </p>
      </div>
    </main>
  );
}
