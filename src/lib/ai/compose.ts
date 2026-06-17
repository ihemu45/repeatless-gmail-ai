import { geminiGenerateJSON } from "./gemini";

/**
 * AI drafting (Gemini). Turns a short natural-language instruction into a
 * complete, ready-to-send email — either a brand new message or a reply that
 * is aware of the entire thread.
 */

export interface DraftedEmail {
  subject: string;
  body: string;
}

export async function draftNewEmail(prompt: string): Promise<DraftedEmail> {
  return geminiGenerateJSON<DraftedEmail>({
    system:
      "You draft professional, ready-to-send emails. Return ONLY JSON of the " +
      'form {"subject": string, "body": string}. The body must be complete and ' +
      "well-structured with an appropriate greeting and sign-off. Keep it concise " +
      "and professional. Do not wrap the JSON in code fences.",
    prompt: `Write an email based on this instruction:\n\n"${prompt}"`,
    temperature: 0.4,
    maxOutputTokens: 900,
  });
}

export async function draftReply(input: {
  prompt: string;
  subject: string;
  transcript: string;
}): Promise<{ body: string }> {
  return geminiGenerateJSON<{ body: string }>({
    system:
      "You draft professional email replies. You are given the FULL thread for " +
      "context — understand what has already been said and respond appropriately. " +
      'Return ONLY JSON of the form {"body": string} containing just the reply ' +
      "body (no subject line). Include a suitable greeting and sign-off. Do not " +
      "wrap the JSON in code fences.",
    prompt:
      `Thread subject: ${input.subject}\n\n` +
      `Thread so far (oldest to newest):\n${input.transcript}\n\n` +
      `Write a reply that follows this instruction: "${input.prompt}"`,
    temperature: 0.4,
    maxOutputTokens: 900,
  });
}
