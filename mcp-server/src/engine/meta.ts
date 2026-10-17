import {
  extractHeadings,
  extractIntroduction,
  extractSentences,
  cleanTextForDisplay,
  detectSearchIntent,
  extractSignificantTokens,
} from "./nlp.js";
import {
  RewriteMetaTagsResult,
  MetaTagSet,
} from "../types.js";

/**
 * Strictly clamps text below a character threshold without cutting words mid-token.
 * Max allowed character length is `maxExclusive - 1`.
 */
function clampUnder(text: string, maxExclusive: number): string {
  const cleaned = cleanTextForDisplay(text);
  if (cleaned.length < maxExclusive) {
    return cleaned;
  }
  const maxAllowed = maxExclusive - 1;
  const sliced = cleaned.substring(0, maxAllowed);
  const lastSpace = sliced.lastIndexOf(" ");
  let candidate = sliced;
  if (lastSpace > maxAllowed * 0.6) {
    candidate = sliced.substring(0, lastSpace);
  }
  // Strip trailing punctuation, conjunctions, and prepositions
  candidate = candidate.replace(/[,:;.\-–—\s]+(and|or|with|on|for|to|in|of|covering)\s*$/i, "");
  return candidate.replace(/[,:;.\-–—]+$/, "").trim();
}

/** Capitalizes words while preserving established acronyms (e.g. SEO, DIY, B2B, AI) */
function capitalizeWords(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => {
      if (w.length <= 4 && w === w.toUpperCase() && /[A-Z]/.test(w)) {
        return w;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Extracts substantive subtopic themes from headings and sentences in the article
 * to construct a genuine, content-grounded summary.
 */
function extractArticleThemes(content: string, keyword: string): {
  subtopicClause: string;
  keyActionSentence: string;
  hasTestedClaims: boolean;
} {
  const headings = extractHeadings(content);
  const sentences = extractSentences(content);
  const kwLower = keyword.toLowerCase().trim();

  // Filter out the main H1/title (first heading) and any headings that merely repeat the keyword
  const subheadings = (headings.length > 1 ? headings.slice(1) : headings)
    .map((h) => h.replace(/^[\d\.\-\s]+/, "").replace(/[*_`]/g, "").trim())
    .filter((h) => {
      const hLower = h.toLowerCase();
      return h.length >= 4 && !hLower.includes(kwLower);
    });

  // Check if content genuinely mentions testing or reviews
  const hasTestedClaims = /\b(we tested|our testing|field tested|hands-on review|lab tested)\b/i.test(content);

  // Build a natural subtopic clause if headings are present
  let subtopicClause = "";
  if (subheadings.length >= 2) {
    const cleanSub = subheadings.slice(0, 3).map((s) => s.toLowerCase());
    if (cleanSub.length === 2) {
      subtopicClause = `${cleanSub[0]} and ${cleanSub[1]}`;
    } else {
      subtopicClause = `${cleanSub[0]}, ${cleanSub[1]}, and ${cleanSub[2]}`;
    }
  }

  // Look for a key informative takeaway sentence from the body
  let keyActionSentence = "";
  for (const s of sentences) {
    const sLower = s.toLowerCase();
    if (
      (sLower.includes("learn") ||
        sLower.includes("ensure") ||
        sLower.includes("vital") ||
        sLower.includes("essential") ||
        sLower.includes("important") ||
        sLower.includes("help") ||
        sLower.includes("best way")) &&
      !s.endsWith("?") &&
      s.length >= 30 &&
      s.length <= 110
    ) {
      keyActionSentence = s.replace(/\.$/, "").trim();
      break;
    }
  }

  return { subtopicClause, keyActionSentence, hasTestedClaims };
}

export function rewriteMetaTags(
  content: string,
  keyword: string,
  siteName?: string
): RewriteMetaTagsResult {
  const cleanKeyword = keyword.trim();
  const kwLower = cleanKeyword.toLowerCase();
  const capKeyword = capitalizeWords(cleanKeyword);
  const year = new Date().getFullYear();
  const intent = detectSearchIntent(cleanKeyword, content);
  const { subtopicClause, keyActionSentence, hasTestedClaims } = extractArticleThemes(content, cleanKeyword);
  const isShortContent = content.trim().split(/\s+/).length < 100;

  // Natural action phrase for keywords starting with "how to"
  const actionPhrase = kwLower.startsWith("how to ") ? kwLower.slice(7) : kwLower;

  // -------------------------------------------------------------------------
  // VARIANT 1: Primary Authority (Accurate, informative overview of the article)
  // -------------------------------------------------------------------------
  let title1 = `${capKeyword}: Complete Guide (${year})`;
  if (title1.length >= 60) {
    title1 = `${capKeyword}: Guide (${year})`;
  }
  if (title1.length >= 60) {
    title1 = `${capKeyword}: Complete Guide`;
  }
  if (title1.length >= 60) {
    title1 = `${capKeyword} Guide`;
  }
  if (title1.length >= 60) {
    title1 = capKeyword;
  }
  if (siteName && `${title1} | ${siteName}`.length < 60) {
    title1 = `${title1} | ${siteName}`;
  }
  title1 = clampUnder(title1, 60);

  let desc1 = "";
  if (isShortContent) {
    // Conservative summary without inventing details
    desc1 = `Read our overview of ${kwLower}. Explore key takeaways, practical advice, and fundamental concepts in this guide.`;
  } else if (intent === "Informational") {
    if (subtopicClause) {
      if (kwLower.startsWith("how to ")) {
        desc1 = `Learn how to ${actionPhrase} with clear guidance on ${subtopicClause}. Follow our practical steps for great results.`;
      } else {
        desc1 = `Learn all about ${kwLower} with practical guidance on ${subtopicClause}. Get straightforward steps and actionable advice.`;
      }
    } else if (keyActionSentence) {
      desc1 = `Learn ${kwLower}: ${keyActionSentence.toLowerCase()}. Follow our clear, step-by-step advice to achieve reliable results.`;
    } else {
      if (kwLower.startsWith("how to ")) {
        desc1 = `Learn how to ${actionPhrase} with clear steps, practical techniques, and proven advice for everyday success.`;
      } else {
        desc1 = `Learn how to master ${kwLower} with clear steps, practical techniques, and proven advice for everyday success.`;
      }
    }
  } else if (intent === "Commercial") {
    if (hasTestedClaims) {
      desc1 = `Explore our hands-on evaluation of ${kwLower}. Compare standout features, key pros and cons, and real-world performance.`;
    } else if (subtopicClause) {
      desc1 = `Compare top options for ${kwLower} covering ${subtopicClause}. Key factors, pros, and cons to make the right choice.`;
    } else {
      desc1 = `Discover the top choices for ${kwLower}. Compare essential features, pros and cons, and value to find the right fit.`;
    }
  } else if (intent === "Transactional") {
    desc1 = `Find the best options and pricing for ${kwLower}. Explore key packages, current deals, and straightforward purchase details.`;
  } else {
    // Navigational
    desc1 = `Official access and comprehensive guide for ${kwLower}. Find direct links, setup instructions, and essential resources.`;
  }
  desc1 = clampUnder(desc1, 155);

  // -------------------------------------------------------------------------
  // VARIANT 2: High CTR (Compelling hook / engagement without fabricated claims)
  // -------------------------------------------------------------------------
  let title2 = "";
  if (intent === "Informational") {
    title2 = `${capKeyword}: Tips & Steps That Work`;
    if (title2.length >= 60) title2 = `${capKeyword}: Easy Step-by-Step Guide`;
    if (title2.length >= 60) title2 = `How to Master ${capKeyword}`;
    if (title2.length >= 60) title2 = `${capKeyword} Tips & Guide`;
  } else if (intent === "Commercial") {
    if (hasTestedClaims) {
      title2 = `Top ${capKeyword} Reviewed & Ranked (${year})`;
      if (title2.length >= 60) title2 = `${capKeyword}: Tested Top Picks`;
    } else {
      title2 = `Top ${capKeyword}: Key Picks & Guide (${year})`;
      if (title2.length >= 60) title2 = `Best ${capKeyword}: What to Choose`;
    }
  } else {
    title2 = `${capKeyword}: Key Details & Overview`;
  }
  if (title2.length >= 60 || !title2.toLowerCase().includes(kwLower)) {
    title2 = `${capKeyword}: Practical Guide`;
  }
  if (title2.length >= 60) {
    title2 = capKeyword;
  }
  title2 = clampUnder(title2, 60);

  let desc2 = "";
  if (isShortContent) {
    desc2 = `Get the essential facts about ${kwLower}. Discover quick insights and useful tips in this concise summary.`;
  } else if (intent === "Informational") {
    if (subtopicClause) {
      desc2 = `Want better results with ${actionPhrase}? Discover key insights on ${subtopicClause} and avoid the most common beginner pitfalls.`;
    } else {
      desc2 = `Looking to succeed with ${actionPhrase}? Discover practical steps, helpful tips, and proven methods to get it right from day one.`;
    }
  } else if (intent === "Commercial") {
    if (hasTestedClaims) {
      desc2 = `Looking for the best ${kwLower}? We evaluated top options for build, usability, and value. Read our unbiased findings.`;
    } else {
      desc2 = `Looking for the right ${kwLower}? Compare leading choices, evaluate key features, and find the right match for your budget.`;
    }
  } else if (intent === "Transactional") {
    desc2 = `Ready to get started with ${kwLower}? Browse top offerings, verify specifications, and pick the best option for your goals.`;
  } else {
    desc2 = `Quick and reliable access to ${kwLower}. Explore key portal features and complete your setup with ease.`;
  }
  desc2 = clampUnder(desc2, 155);

  // -------------------------------------------------------------------------
  // VARIANT 3: Benefit / Decision-Focused (Practical outcome & problem solving)
  // -------------------------------------------------------------------------
  let title3 = "";
  if (intent === "Informational") {
    title3 = `${capKeyword}: How to Avoid Common Mistakes`;
    if (title3.length >= 60) title3 = `${capKeyword}: Helpful Advice & Tips`;
    if (title3.length >= 60) title3 = `${capKeyword}: Practical Advice`;
    if (title3.length >= 60) title3 = `${capKeyword} Guide`;
  } else if (intent === "Commercial") {
    title3 = `${capKeyword} Guide: How to Pick Right`;
    if (title3.length >= 60) title3 = `How to Choose ${capKeyword}`;
    if (title3.length >= 60) title3 = `${capKeyword}: Selection Guide`;
  } else {
    title3 = `${capKeyword}: Step-by-Step Overview`;
  }
  if (title3.length >= 60 || !title3.toLowerCase().includes(kwLower)) {
    title3 = `${capKeyword} Guide`;
  }
  if (title3.length >= 60) {
    title3 = capKeyword;
  }
  title3 = clampUnder(title3, 60);

  let desc3 = "";
  if (isShortContent) {
    desc3 = `A straightforward look at ${kwLower}. Learn key points and practical guidance to help you get started quickly.`;
  } else if (intent === "Informational") {
    if (subtopicClause) {
      desc3 = `Make ${actionPhrase} simple and stress-free. Practical guidance on ${subtopicClause} to help you avoid common mistakes.`;
    } else {
      desc3 = `Make ${actionPhrase} simple and rewarding. Discover practical guidance, helpful answers, and proven advice for steady progress.`;
    }
  } else if (intent === "Commercial") {
    desc3 = `Find the ideal ${kwLower} for your exact needs. Explore practical recommendations, pros and cons, and smart buying advice inside.`;
  } else if (intent === "Transactional") {
    desc3 = `Save time finding ${kwLower}. Compare practical packages, check requirements, and choose with confidence today.`;
  } else {
    desc3 = `Everything you need to know about ${kwLower} in one place. Direct navigation, clear instructions, and support.`;
  }
  desc3 = clampUnder(desc3, 155);

  const metaTags: MetaTagSet[] = [
    {
      title: title1,
      titleLength: title1.length,
      description: desc1,
      descriptionLength: desc1.length,
      variant: "primary",
    },
    {
      title: title2,
      titleLength: title2.length,
      description: desc2,
      descriptionLength: desc2.length,
      variant: "high-ctr",
    },
    {
      title: title3,
      titleLength: title3.length,
      description: desc3,
      descriptionLength: desc3.length,
      variant: "benefit-focused",
    },
  ];

  const allTitlesCompliant = metaTags.every((m) => m.titleLength < 60);
  const allDescriptionsCompliant = metaTags.every((m) => m.descriptionLength < 155);

  return {
    keyword: cleanKeyword,
    metaTags,
    validation: {
      maxTitleLimit: 60,
      maxDescriptionLimit: 155,
      allTitlesCompliant,
      allDescriptionsCompliant,
    },
  };
}
