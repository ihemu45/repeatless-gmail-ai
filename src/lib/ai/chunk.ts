/**
 * Text chunking for the embedding pipeline.
 *
 * Emails range from one line to long newsletters, so we split bodies into
 * overlapping, sentence/paragraph-aware chunks. Overlap preserves context that
 * straddles a boundary; the cap keeps each chunk well inside the embedding
 * model's input limit and keeps retrieval granular.
 */
export function chunkText(
  text: string,
  maxChars = 1200,
  overlap = 150,
): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // Prefer to break at a paragraph or sentence boundary in the back half
      // of the window for cleaner chunks.
      const window = clean.slice(start, end);
      const para = window.lastIndexOf("\n");
      const sentence = window.lastIndexOf(". ");
      const breakAt = Math.max(para, sentence);
      if (breakAt > maxChars * 0.5) end = start + breakAt + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
