/**
 * Centralised, validated access to environment variables.
 *
 * Server-only secrets are read lazily so that importing this module from a
 * client component (which would only touch NEXT_PUBLIC_* values) does not throw.
 * Each getter fails loudly with a clear message if a required variable is missing
 * — far easier to debug than a downstream `undefined`.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in (see SETUP.md).`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },

  // Google OAuth / Gmail
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get googleRedirectUri() {
    return `${this.appUrl}/api/auth/callback`;
  },

  // Supabase
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Gemini (primary)
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optional("GEMINI_MODEL", "gemini-2.5-flash");
  },
  get geminiEmbedModel() {
    return optional("GEMINI_EMBED_MODEL", "gemini-embedding-001");
  },

  // NVIDIA NIM (secondary)
  get nimApiKey() {
    return required("NVIDIA_NIM_API_KEY");
  },
  get nimBaseUrl() {
    return optional("NVIDIA_NIM_BASE_URL", "https://integrate.api.nvidia.com/v1");
  },
  get nimModel() {
    return optional("NVIDIA_NIM_MODEL", "meta/llama-3.1-8b-instruct");
  },

  // Security
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get encryptionKey() {
    return required("ENCRYPTION_KEY");
  },

  // Cron — required so the cron endpoint always fails closed (never runs
  // unauthenticated due to a missing env var).
  get cronSecret() {
    return required("CRON_SECRET");
  },
};

/** Embedding dimensionality for Gemini text-embedding-004. Must match the SQL schema. */
export const EMBEDDING_DIM = 768;
