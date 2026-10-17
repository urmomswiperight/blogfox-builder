/**
 * Shared input guards used by every HTTP surface of the server
 * (MCP Streamable HTTP, MCP SSE tool calls, the direct JSON-RPC endpoint
 * and the REST action endpoints).
 *
 * `nonEnglishContentError` returns a human-readable error message (hard
 * failure) and `keywordAbsentWarning` returns a human-readable warning
 * (best-effort result still returned); both return `null` when the input is
 * acceptable. They run *after* Zod has already enforced type, emptiness and
 * the 20,000-character cap.
 */

const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "is", "to", "of", "in", "you", "that", "it", "for", "with",
  "are", "this", "be", "on", "not", "have", "they", "as", "at", "or", "from",
  "by", "an", "but", "if", "we", "can", "will", "do", "all", "about", "which",
  "there", "their", "been", "was", "more", "when", "how", "said", "each",
  "other", "its", "into", "than", "then", "some", "would", "could", "should",
  "who", "what", "where", "why", "our", "us", "he", "she", "his", "her",
  "them", "being", "one", "two", "very", "over", "after", "before", "between",
  "during", "under", "again", "also", "any", "many", "such", "only", "just",
]);

// High-frequency function words of Spanish, French, Portuguese and Italian.
// None of them are common standalone English words, so three or more hits in
// an English article are essentially impossible.
const ROMANCE_FUNCTION_WORDS = new Set([
  "el", "la", "los", "las", "del", "al", "un", "una", "unas", "unos", "y",
  "o", "que", "de", "en", "con", "por", "para", "como", "pero", "más",
  "mas", "está", "esta", "este", "estos", "estas", "están", "estan", "ese",
  "esa", "eso", "donde", "desde", "cuando", "porque", "entre", "sobre",
  "muy", "sin", "les", "nos", "ellos", "usted", "fue", "son", "era", "hay",
  "hasta", "quien", "cual", "cuya", "cuyo", "es", "se", "su", "sus", "lo",
  "también", "tambien", "todo", "todos", "cada", "otro", "otra", "otros",
  "otras", "le", "les", "des", "du", "est", "et", "dans", "avec", "qui",
  "sur", "pas", "nous", "vous", "être", "etre", "ces", "tout", "tous",
  "fait", "comme", "mais", "au", "aux", "si", "ne", "peut", "être",
]);

// High-frequency function words of German and Dutch.
const GERMANIC_FUNCTION_WORDS = new Set([
  "der", "die", "das", "und", "ist", "nicht", "mit", "auf", "für", "fur",
  "von", "zu", "den", "dem", "eine", "einen", "aber", "auch", "nach",
  "wird", "bei", "aus", "durch", "wenn", "dann", "über", "uber", "noch",
  "nur", "schon", "viel", "mehr", "gibt", "kann", "soll", "werden", "im",
  "ich", "nicht", "habe", "hier", "bin", "war", "einem", "einer",
]);

/**
 * Rejects content that is not English text.
 *
 * Strategy (in order):
 *  1. No letters at all -> reject.
 *  2. Non-Latin script dominates (Amharic, Chinese, Arabic, Cyrillic, ...)
 *     -> reject when fewer than 70% of all letters are basic Latin letters.
 *  3. Latin-script but clearly another language: count function words of
 *     English vs. Romance/Germanic languages; reject when foreign hits
 *     reach 3 AND outnumber the English hits.
 */
export function nonEnglishContentError(content: string): string | null {
  const letters = content.match(/\p{L}/gu);
  if (!letters || letters.length === 0) {
    return "Content must contain English text: no letters were found in the input.";
  }

  const latinLetters = letters.filter((ch) => /[a-zA-Z]/.test(ch)).length;
  if (latinLetters / letters.length < 0.7) {
    return (
      "Only English content is supported: the text is not written in the " +
      "Latin (English) alphabet. Translate it to English before analyzing it."
    );
  }

  const words = content.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let englishHits = 0;
  let foreignHits = 0;
  for (const w of words) {
    if (ENGLISH_FUNCTION_WORDS.has(w)) englishHits++;
    if (ROMANCE_FUNCTION_WORDS.has(w) || GERMANIC_FUNCTION_WORDS.has(w)) foreignHits++;
  }

  if (foreignHits >= 3 && foreignHits > englishHits) {
    return (
      "Only English content is supported: the text appears to be written in " +
      "another language. Translate it to English before analyzing it."
    );
  }

  return null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Warns when the target keyword never occurs in the content.
 *
 * This is a *warning*, not an error: "what words am I missing?" style
 * requests often come with a keyword the article does not contain yet, so
 * every tool returns a best-effort result with this warning attached
 * (`keywordFound: false`) instead of refusing to run.
 */
export function keywordAbsentWarning(content: string, keyword: string): string | null {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return null; // Zod already rejects empty keywords
  if (normalize(content).includes(normalizedKeyword)) return null;
  return (
    `Keyword "${keyword.trim()}" was not found anywhere in the content. ` +
    "Results are best-effort: the score is computed without this keyword, suggested terms are " +
    "derived from the keyword itself rather than from a gap analysis against the text, and meta " +
    "tags target a keyword that is not yet present in the page. Add the keyword to the article " +
    "(title, introduction and body) for accurate results."
  );
}
