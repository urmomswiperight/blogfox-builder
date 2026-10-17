// Local lightweight NLP utilities - zero external dependencies, 100% offline

export const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
  "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves"
]);

/** Tokenize text into lowercase alphanumeric words */
export function tokenizeWords(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().replace(/['’]/g, "");
  const matches = cleaned.match(/[a-z0-9]+/g);
  return matches || [];
}

/** Extract meaningful tokens excluding stop words */
export function extractSignificantTokens(text: string): string[] {
  const words = tokenizeWords(text);
  return words.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Lightweight English stemmer covering common inflections:
 * plurals (-s, -es, -ies), verb forms (-ing, -ed), and derivational suffixes (-ment, -tion, -ness, -able, -age).
 */
export function stemWord(word: string): string {
  if (!word || word.length <= 3) return word.toLowerCase();
  let w = word.toLowerCase();

  // Irregular / special cases
  if (w === "tomatoes") return "tomato";
  if (w === "potatoes") return "potato";
  if (w === "leaves") return "leaf";
  if (w === "running" || w === "runners" || w === "runner") return "run";
  if (w.startsWith("prepar")) return "prepar";

  // Plurals & verb endings
  if (w.endsWith("ies") && w.length > 4) {
    return w.slice(0, -3) + "y";
  }
  if (w.endsWith("sses")) {
    return w.slice(0, -2);
  }
  if (w.endsWith("es") && w.length > 4) {
    const stem = w.slice(0, -2);
    if (stem.endsWith("ch") || stem.endsWith("sh") || stem.endsWith("x") || stem.endsWith("z") || stem.endsWith("ss")) {
      return stem;
    }
    if (stem.endsWith("t") || stem.endsWith("d") || stem.endsWith("v") || stem.endsWith("g")) {
      return w.slice(0, -1);
    }
  }
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    w = w.slice(0, -1);
  }

  // -ing endings
  if (w.endsWith("ing") && w.length > 5) {
    const base = w.slice(0, -3);
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !"aeiou".includes(base[base.length - 1])) {
      return base.slice(0, -1);
    }
    if (base.length >= 3 && !"aeiou".includes(base[base.length - 1]) && "aeiou".includes(base[base.length - 2]) && !"aeiou".includes(base[base.length - 3])) {
      return base + "e";
    }
    return base;
  }

  // -ed endings
  if (w.endsWith("ed") && w.length > 4) {
    const base = w.slice(0, -2);
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !"aeiou".includes(base[base.length - 1])) {
      return base.slice(0, -1);
    }
    if (base.length >= 3 && !"aeiou".includes(base[base.length - 1]) && "aeiou".includes(base[base.length - 2]) && !"aeiou".includes(base[base.length - 3])) {
      return base + "e";
    }
    return base;
  }

  // Common derivational suffixes
  if (w.endsWith("tion") && w.length > 6) {
    return w.slice(0, -4);
  }
  if (w.endsWith("ness") && w.length > 6) {
    return w.slice(0, -4);
  }
  if (w.endsWith("ment") && w.length > 6) {
    return w.slice(0, -4);
  }
  if (w.endsWith("able") && w.length > 6) {
    return w.slice(0, -4);
  }
  if (w.endsWith("age") && w.length > 5) {
    return w.slice(0, -3);
  }

  // Silent e removal for uniform comparison (prepare -> prepar, prune -> prun)
  if (w.endsWith("e") && w.length > 4 && !"aeiou".includes(w[w.length - 2])) {
    return w.slice(0, -1);
  }

  return w;
}

/** Stems every word in a sequence */
export function stemTokens(tokens: string[]): string[] {
  return tokens.map((t) => stemWord(t));
}

/** Normalizes a phrase into stemmed words for semantic comparison */
export function normalizePhraseTokens(phrase: string): string[] {
  return stemTokens(tokenizeWords(phrase));
}

/**
 * Counts exact occurrences of a phrase in text, with proper punctuation handling
 * (including slashes like 50/30/20, hyphens, and quotes).
 */
export function countExactMatches(text: string, phrase: string): number {
  if (!text || !phrase) return 0;
  const pTokens = tokenizeWords(phrase);
  if (pTokens.length === 0) return 0;

  const tTokens = tokenizeWords(text);
  if (tTokens.length < pTokens.length) return 0;

  let count = 0;
  for (let i = 0; i <= tTokens.length - pTokens.length; i++) {
    let match = true;
    for (let j = 0; j < pTokens.length; j++) {
      if (tTokens[i + j] !== pTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      count++;
      i += pTokens.length - 1;
    }
  }
  return count;
}

/**
 * Counts occurrences of a phrase allowing morphological variation
 */
export function countMorphologicalMatches(text: string, phrase: string): number {
  if (!text || !phrase) return 0;
  const pStemmed = normalizePhraseTokens(phrase);
  if (pStemmed.length === 0) return 0;

  const tTokens = tokenizeWords(text);
  if (tTokens.length < pStemmed.length) return 0;
  const tStemmed = stemTokens(tTokens);

  let count = 0;
  for (let i = 0; i <= tStemmed.length - pStemmed.length; i++) {
    let match = true;
    for (let j = 0; j < pStemmed.length; j++) {
      if (tStemmed[i + j] !== pStemmed[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      count++;
      i += pStemmed.length - 1;
    }
  }
  return count;
}

/**
 * Checks whether a term or concept is present in the text with morphological awareness.
 * For single words: checks stemmed token inclusion.
 * For multi-word phrases: checks consecutive stemmed sequence, sentence co-occurrence, or conjunction alternatives.
 */
export function isTermPresentInText(content: string, term: string): boolean {
  if (!content || !term) return false;
  const termTokens = tokenizeWords(term);
  if (termTokens.length === 0) return false;

  const contentTokens = tokenizeWords(content);
  if (contentTokens.length === 0) return false;

  const contentStemmed = stemTokens(contentTokens);
  const termStemmed = stemTokens(termTokens);

  // Single word term
  if (termStemmed.length === 1) {
    const target = termStemmed[0];
    return contentStemmed.includes(target);
  }

  // Compound phrases joined by "and", "or", or "vs" (e.g. "staking and caging", "determinate vs indeterminate")
  if (term.includes(" and ") || term.includes(" or ") || term.includes(" vs ")) {
    const parts = term.split(/\s+(?:and|or|vs)\s+/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // If any of the coordinated parts is present in content, mark as present
      if (parts.some((part) => isTermPresentInText(content, part))) {
        return true;
      }
    }
  }

  // Multi-word phrase: look for consecutive sequence first
  for (let i = 0; i <= contentStemmed.length - termStemmed.length; i++) {
    let match = true;
    for (let j = 0; j < termStemmed.length; j++) {
      if (contentStemmed[i + j] !== termStemmed[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }

  // If multi-word phrase contains 2-3 words (e.g. "soil preparation", "sunlight exposure"), also check sentence co-occurrence
  if (termStemmed.length >= 2 && termStemmed.length <= 3) {
    const sentences = extractSentences(content);
    for (const sentence of sentences) {
      const sStemmed = stemTokens(tokenizeWords(sentence));
      if (termStemmed.every((t) => sStemmed.includes(t))) {
        return true;
      }
    }
  }

  return false;
}

/** Extracts all headings from markdown, HTML, or bold line structures */
export function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Markdown headings (# Title, ## Subheading)
    const mdMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (mdMatch) {
      const text = mdMatch[1].replace(/[*_`]/g, "").trim();
      if (text) headings.push(text);
      continue;
    }

    // HTML headings (<h1>Title</h1>, etc.)
    const htmlMatch = trimmed.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    if (htmlMatch) {
      const text = htmlMatch[1].replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").trim();
      if (text) headings.push(text);
      continue;
    }

    // Bold standalone line acting as heading (e.g. **1. Soil Preparation** or **Watering:**)
    const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*:?$/);
    if (boldMatch && boldMatch[1].length >= 4 && boldMatch[1].length <= 80) {
      headings.push(boldMatch[1].trim());
      continue;
    }
  }
  return headings;
}

/** Extracts introduction text (before first major heading or up to wordLimit) */
export function extractIntroduction(content: string, wordLimit = 150): string {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  const introLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Stop if we hit a subheading (H2/H3) after having collected some text
    if (introLines.length > 0 && (/^#{2,6}\s+/.test(line) || /<h[2-6]/i.test(line))) {
      break;
    }
    // Strip markdown formatting
    const cleaned = line.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim();
    if (cleaned) introLines.push(cleaned);
  }

  const fullIntro = introLines.join(" ");
  const words = fullIntro.split(/\s+/);
  return words.slice(0, wordLimit).join(" ");
}

/** Extracts concluding text */
export function extractConclusion(content: string, wordLimit = 150): string {
  if (!content) return "";
  const words = content.trim().split(/\s+/);
  if (words.length <= wordLimit) return content;
  return words.slice(words.length - wordLimit).join(" ");
}

/** Extracts clean sentences from article body, skipping headings and code */
export function extractSentences(content: string): string[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const bodyTextLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("<h")) continue;
    bodyTextLines.push(trimmed.replace(/[*_`\[\]]/g, ""));
  }

  const fullText = bodyTextLines.join(" ");
  const rawSentences = fullText.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [fullText];
  return rawSentences
    .map((s) => cleanTextForDisplay(s))
    .filter((s) => s.length > 15 && s.split(/\s+/).length >= 4);
}

/** Cleans and collapses whitespace */
export function cleanTextForDisplay(text: string): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

/** Detects search intent from keyword and article content */
export function detectSearchIntent(
  keyword: string,
  content: string
): "Informational" | "Commercial" | "Transactional" | "Navigational" {
  const kw = keyword.toLowerCase();
  const sample = (kw + " " + content.slice(0, 1000)).toLowerCase();

  // Transactional intent
  if (
    /\b(buy|order|discount|coupon|pricing|price|cost to buy|shop|purchase|deal)\b/i.test(kw) ||
    (/\b(add to cart|checkout|purchase now|pricing plans)\b/i.test(sample) && !/\bhow to\b/i.test(kw))
  ) {
    return "Transactional";
  }

  // Commercial intent (reviews, comparisons, best picks)
  if (
    /\b(best|top|vs|versus|review|reviews|comparison|buyers guide|buyer's guide|top rated)\b/i.test(kw) ||
    (/\b(we tested|our top picks|pros and cons|hands-on review)\b/i.test(sample) && !/\bhow to\b/i.test(kw))
  ) {
    return "Commercial";
  }

  // Navigational intent
  if (/\b(login|sign in|portal|official website|homepage|account dashboard)\b/i.test(kw)) {
    return "Navigational";
  }

  // Default to Informational (how-to, tutorials, guides, explanations)
  return "Informational";
}

/**
 * Extracts substantive facts and summary points from article content
 * so generated metadata accurately reflects what the article is about.
 */
export function extractContentSummaryData(content: string, keyword: string): {
  keyHeadings: string[];
  mainPoints: string[];
  informativeSummary: string;
} {
  const headings = extractHeadings(content);
  const sentences = extractSentences(content);
  const keyTokens = extractSignificantTokens(keyword);

  // Filter out the primary H1/title from subheadings
  const subHeadings = headings.filter(
    (h) => !keyTokens.every((t) => h.toLowerCase().includes(t)) || headings.indexOf(h) > 0
  );

  const informativeSentences: string[] = [];
  for (const s of sentences) {
    if (s.endsWith("?") || s.length < 30) continue;
    if (
      /\b(learn|discover|step|guide|ensure|remember|vital|essential|important|requires|helps|protect|tips|best)\b/i.test(
        s
      )
    ) {
      informativeSentences.push(s);
    }
  }

  let summary = "";
  if (subHeadings.length >= 2) {
    const topicList = subHeadings.slice(0, 3).map((h) => h.replace(/^[\d\.\-\s]+/, "").toLowerCase());
    summary = `covering ${topicList.join(", ")}`;
  } else if (informativeSentences.length > 0) {
    summary = informativeSentences[0].replace(/\.$/, "");
  }

  return {
    keyHeadings: subHeadings,
    mainPoints: informativeSentences.slice(0, 3),
    informativeSummary: summary,
  };
}

/**
 * Generates natural keyword variants for flexible matching
 * (e.g. "how to grow tomatoes at home" -> ["grow tomatoes at home", "growing tomatoes at home"])
 */
export function generateKeywordVariants(keyword: string): string[] {
  const clean = keyword.trim().toLowerCase().replace(/[?:!.,;]/g, "");
  const variants = new Set<string>([clean]);

  const stripped = clean.replace(/^(how to|guide to|best way to|tips for|steps to)\s+/i, "");
  if (stripped !== clean) {
    variants.add(stripped);
  }

  const words = stripped.split(/\s+/);
  if (words.length > 0) {
    if (words[0].endsWith("ing")) {
      const baseVerb = stemWord(words[0]);
      variants.add([baseVerb, ...words.slice(1)].join(" "));
    } else {
      const ingVerb = words[0] + (words[0].endsWith("e") ? "ing".slice(1) : "ing");
      variants.add([ingVerb, ...words.slice(1)].join(" "));
    }
  }

  return Array.from(variants);
}
