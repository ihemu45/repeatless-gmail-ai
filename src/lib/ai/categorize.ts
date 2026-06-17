import { nimChatJSON } from "./nim";
import { EMAIL_CATEGORIES, type EmailCategory } from "../types";

/**
 * Email categorization, powered by the NVIDIA NIM model.
 *
 * Classification is a high-volume, low-creativity task (one call per message),
 * so it's a natural fit for the fast secondary model rather than spending
 * Gemini quota on it.
 */
const SYSTEM_PROMPT = `You are an email classifier. Classify the email into EXACTLY ONE category:

- newsletters: subscription content, digests, marketing campaigns, promotions
- job: applications, offers, rejections, interview requests, recruiter outreach
- finance: invoices, receipts, bank alerts, payments, statements, billing
- notifications: automated system alerts, OTPs, security codes, platform/app updates
- personal: direct human-to-human personal communication (friends, family)
- work: project discussions, team/colleague communication, professional correspondence
- other: anything that does not clearly fit the categories above

Respond with ONLY a JSON object, no prose: {"category": "<category>"}`;

export async function categorizeEmail(input: {
  from: string;
  subject: string;
  snippet: string;
  body?: string;
}): Promise<EmailCategory> {
  const content =
    `From: ${input.from}\n` +
    `Subject: ${input.subject}\n\n` +
    `${(input.body || input.snippet || "").slice(0, 1500)}`;

  try {
    const res = await nimChatJSON<{ category: string }>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      { maxTokens: 40, temperature: 0 },
    );
    const category = (res.category || "").toLowerCase().trim();
    return (EMAIL_CATEGORIES as string[]).includes(category)
      ? (category as EmailCategory)
      : "other";
  } catch {
    // Never let a classification failure block ingestion.
    return "other";
  }
}
