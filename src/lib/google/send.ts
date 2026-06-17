import { getAccessTokenForUser } from "./oauth";
import { sendRawMessage } from "./gmail";

/**
 * Compose and send RFC 5322 messages through the Gmail API.
 *
 * For replies, we set In-Reply-To and References to the thread's prior
 * Message-ID(s) and pass Gmail's threadId, so the sent message threads
 * correctly in Gmail (and in the recipient's client) rather than appearing as
 * a new conversation.
 */

function encodeHeaderValue(value: string): string {
  // RFC 2047 encode non-ASCII header values (e.g. subjects with emoji/accents).
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SendEmailInput {
  fromEmail: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null; // Message-ID of the message being replied to
  references?: string | null; // References header chain
  threadId?: string | null; // Gmail thread id
}

export async function sendEmail(
  userId: string,
  input: SendEmailInput,
): Promise<{ id: string; threadId: string }> {
  const accessToken = await getAccessTokenForUser(userId);

  const fromHeader = input.fromName
    ? `${encodeHeaderValue(input.fromName)} <${input.fromEmail}>`
    : input.fromEmail;

  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${input.to.join(", ")}`,
    input.cc && input.cc.length > 0 ? `Cc: ${input.cc.join(", ")}` : null,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.references ? `References: ${input.references}` : null,
  ].filter(Boolean) as string[];

  const raw = `${headerLines.join("\r\n")}\r\n\r\n${input.body}`;
  return sendRawMessage(accessToken, toBase64Url(raw), input.threadId ?? undefined);
}
