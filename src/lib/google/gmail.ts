import { withBackoff } from "../ratelimit";
import type { Contact } from "../types";

/**
 * Thin, typed wrapper over the Gmail REST API.
 *
 * We call the REST endpoints directly with fetch (rather than the heavy
 * `googleapis` SDK) so we have full control over batching, pagination and
 * rate-limit handling — which is exactly what the assignment asks us to
 * demonstrate. Every call goes through `gmailFetch`, which transparently
 * retries transient failures (429 / rateLimitExceeded / 5xx) with exponential
 * backoff.
 */

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof GmailApiError) {
    if (err.status === 429 || err.status === 408) return true;
    if (err.status >= 500) return true;
    // 403 is overloaded by Gmail: rate-limit errors are transient, permission
    // errors are not.
    if (
      err.status === 403 &&
      ["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(
        err.reason,
      )
    ) {
      return true;
    }
    return false;
  }
  // Low-level network failures: Node's fetch (undici) wraps these as a
  // TypeError ("fetch failed"); also handle aborts and common socket errors.
  if (err instanceof TypeError) return true;
  const e = err as { name?: string; code?: string };
  if (e?.name === "AbortError") return true;
  if (e?.code && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(e.code)) {
    return true;
  }
  return false;
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return withBackoff(
    async () => {
      const res = await fetch(`${GMAIL_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (!res.ok) {
        let reason = "";
        let message = res.statusText;
        try {
          const body = await res.json();
          reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
          message = body?.error?.message ?? message;
        } catch {
          /* non-JSON error body */
        }
        throw new GmailApiError(res.status, reason, message);
      }
      return (await res.json()) as T;
    },
    { shouldRetry: isTransient, maxRetries: 6 },
  );
}

// ----------------------------------------------------------------------------
//  Raw API types (only the fields we use)
// ----------------------------------------------------------------------------
interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}

interface ListMessagesResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface HistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
    messagesDeleted?: { message: { id: string; threadId: string } }[];
    labelsAdded?: { message: { id: string }; labelIds: string[] }[];
    labelsRemoved?: { message: { id: string }; labelIds: string[] }[];
  }>;
  nextPageToken?: string;
  historyId?: string;
}

// ----------------------------------------------------------------------------
//  API calls
// ----------------------------------------------------------------------------
export async function getProfile(
  accessToken: string,
): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  return gmailFetch(accessToken, "/profile");
}

export async function listMessageIds(
  accessToken: string,
  opts: { pageToken?: string; maxResults?: number; q?: string } = {},
): Promise<ListMessagesResponse> {
  const params = new URLSearchParams();
  params.set("maxResults", String(opts.maxResults ?? 100));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  if (opts.q) params.set("q", opts.q);
  return gmailFetch(accessToken, `/messages?${params.toString()}`);
}

export async function getMessage(
  accessToken: string,
  id: string,
  format: "full" | "metadata" | "minimal" = "full",
): Promise<GmailMessage> {
  return gmailFetch(accessToken, `/messages/${id}?format=${format}`);
}

export async function listHistory(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryResponse> {
  const params = new URLSearchParams();
  params.set("startHistoryId", startHistoryId);
  // Request every change type so incremental sync applies additions, deletions
  // AND label/read-state changes (the API only returns the types you ask for).
  for (const t of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) {
    params.append("historyTypes", t);
  }
  if (pageToken) params.set("pageToken", pageToken);
  return gmailFetch(accessToken, `/history?${params.toString()}`);
}

export async function sendRawMessage(
  accessToken: string,
  rawBase64Url: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  return gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawBase64Url, ...(threadId ? { threadId } : {}) }),
  });
}

export async function modifyLabels(
  accessToken: string,
  id: string,
  addLabelIds: string[],
  removeLabelIds: string[] = [],
): Promise<unknown> {
  return gmailFetch(accessToken, `/messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

// ----------------------------------------------------------------------------
//  Parsing helpers
// ----------------------------------------------------------------------------
function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Parse an RFC 5322 address list ("Alice <a@x.com>, b@y.com") into contacts.
 * Splits only on top-level commas — commas inside a quoted display name
 * (`"Doe, John" <j@x.com>`) or angle brackets are not separators. */
export function parseContacts(headerValue: string): Contact[] {
  if (!headerValue) return [];

  const parts: string[] = [];
  let buf = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of headerValue) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "<") inAngle = true;
    else if (ch === ">") inAngle = false;
    if (ch === "," && !inQuotes && !inAngle) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)<([^>]+)>$/);
      if (match) {
        return {
          name: match[1].trim().replace(/^"|"$/g, "").replace(/"$/, "").trim(),
          email: match[2].trim().toLowerCase(),
        };
      }
      return { name: "", email: part.replace(/^<|>$/g, "").trim().toLowerCase() };
    });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walk the MIME tree and extract the best plain-text representation of a body. */
export function extractBodyText(payload?: GmailPart): string {
  if (!payload) return "";
  const textParts: string[] = [];
  const htmlParts: string[] = [];

  const walk = (part: GmailPart) => {
    const mime = part.mimeType ?? "";
    if (part.body?.data) {
      if (mime === "text/plain") textParts.push(decodeBase64Url(part.body.data));
      else if (mime === "text/html") htmlParts.push(decodeBase64Url(part.body.data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);

  const text =
    textParts.length > 0
      ? textParts.join("\n").trim()
      : stripHtml(htmlParts.join("\n"));

  // Cap stored body size; AI calls and the DB don't need megabyte emails.
  return text.slice(0, 50_000);
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  rfc822MessageId: string;
  inReplyTo: string;
  references: string;
  fromName: string;
  fromEmail: string;
  to: Contact[];
  cc: Contact[];
  subject: string;
  snippet: string;
  bodyText: string;
  labelIds: string[];
  isUnread: boolean;
  internalDate: string | null;
}

/** Normalise a raw Gmail message into our storage shape. */
export function parseMessage(msg: GmailMessage): ParsedMessage {
  const headers = msg.payload?.headers;
  const from = parseContacts(getHeader(headers, "From"))[0] ?? {
    name: "",
    email: "",
  };
  const labelIds = msg.labelIds ?? [];
  return {
    id: msg.id,
    threadId: msg.threadId,
    rfc822MessageId: getHeader(headers, "Message-ID"),
    inReplyTo: getHeader(headers, "In-Reply-To"),
    references: getHeader(headers, "References"),
    fromName: from.name,
    fromEmail: from.email,
    to: parseContacts(getHeader(headers, "To")),
    cc: parseContacts(getHeader(headers, "Cc")),
    subject: getHeader(headers, "Subject"),
    snippet: msg.snippet ?? "",
    bodyText: extractBodyText(msg.payload),
    labelIds,
    isUnread: labelIds.includes("UNREAD"),
    internalDate: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : null,
  };
}
