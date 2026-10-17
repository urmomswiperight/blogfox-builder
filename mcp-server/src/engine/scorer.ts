import {
  tokenizeWords,
  countExactMatches,
  countMorphologicalMatches,
  extractHeadings,
  extractIntroduction,
  extractSignificantTokens,
  generateKeywordVariants,
  detectSearchIntent,
} from "./nlp.js";
import {
  ScoreContentResult,
  ScoreBreakdown,
  ContentMetrics,
} from "../types.js";

export function scoreContentAgainstKeyword(
  content: string,
  keyword: string
): ScoreContentResult {
  const words = tokenizeWords(content);
  const totalWords = words.length;
  const characterCount = content.length;

  const headings = extractHeadings(content);
  const introText = extractIntroduction(content, 150);
  const intent = detectSearchIntent(keyword, content);

  // Keyword variations (handles punctuation, capitalization, common grammatical forms)
  const variants = generateKeywordVariants(keyword);
  const keywordTokens = extractSignificantTokens(keyword);

  // Exact & variant keyword matching
  let keywordMatches = countExactMatches(content, keyword);
  let variantMatches = 0;
  for (const v of variants) {
    if (v !== keyword.toLowerCase().trim()) {
      variantMatches += countExactMatches(content, v);
    }
  }
  const totalEffectiveMatches = keywordMatches + variantMatches;

  // Keyword density
  const keywordDensityPercent =
    totalWords > 0
      ? Number(((keywordMatches / totalWords) * 100).toFixed(2))
      : 0;

  // Check presence in introduction
  const keywordInIntroduction =
    countExactMatches(introText, keyword) > 0 ||
    variants.some((v) => countExactMatches(introText, v) > 0);

  const introTokens = extractSignificantTokens(introText);
  const introTokenOverlap =
    keywordTokens.length > 0
      ? keywordTokens.filter((kt) => introTokens.includes(kt)).length / keywordTokens.length
      : 0;

  // Check presence in headings
  const keywordInHeadings = headings.some(
    (h) =>
      countExactMatches(h, keyword) > 0 ||
      variants.some((v) => countExactMatches(h, v) > 0)
  );

  const firstHeading = headings.length > 0 ? headings[0] : "";
  const firstHeadingHasKeyword =
    countExactMatches(firstHeading, keyword) > 0 ||
    variants.some((v) => countExactMatches(firstHeading, v) > 0);

  const partialTokenMatchesInHeadings = headings.some((h) => {
    const hTokens = extractSignificantTokens(h);
    return keywordTokens.some((kt) => hTokens.includes(kt));
  });

  // =========================================================================
  // Sub-score 1: Keyword Prominence (0-25)
  // Evaluates clear topic signalling in the title/H1 and introduction.
  // =========================================================================
  let keywordProminence = 0;
  let prominenceExplanation = "";

  // Introduction prominence (max 13 pts)
  if (keywordInIntroduction) {
    keywordProminence += 13;
    prominenceExplanation += "Primary keyword is clearly introduced early in the text. ";
  } else if (introTokenOverlap >= 0.75) {
    keywordProminence += 10;
    prominenceExplanation += "Key topical concepts are strongly established in the opening paragraphs. ";
  } else if (introTokenOverlap > 0) {
    const partialPts = Math.round(introTokenOverlap * 8);
    keywordProminence += partialPts;
    prominenceExplanation += `Introductory paragraphs touch on topic elements (${partialPts}/13 pts). `;
  } else {
    prominenceExplanation += "Target keyword is missing from the opening introduction. ";
  }

  // Heading / Title prominence (max 12 pts)
  if (firstHeadingHasKeyword) {
    keywordProminence += 12;
    prominenceExplanation += "Title/H1 prominently includes the target keyword.";
  } else if (
    firstHeading &&
    keywordTokens.filter((kt) => extractSignificantTokens(firstHeading).includes(kt)).length >=
      Math.ceil(keywordTokens.length * 0.7)
  ) {
    keywordProminence += 9;
    prominenceExplanation += "Title/H1 closely reflects the core target search topic.";
  } else if (keywordInHeadings) {
    keywordProminence += 7;
    prominenceExplanation += "Target keyword appears in a subheading though not the main title.";
  } else if (totalEffectiveMatches > 0) {
    keywordProminence += 4;
    prominenceExplanation += "Topic is covered in body copy but absent from primary headings.";
  } else {
    prominenceExplanation += "Neither title nor headings reflect the target keyword.";
  }
  keywordProminence = Math.min(25, keywordProminence);

  // =========================================================================
  // Sub-score 2: Heading & Structure (0-25)
  // Evaluates scannability, logical hierarchy, and topical subheadings.
  // =========================================================================
  let headingStructure = 0;
  let headingExplanation = "";

  // Structural depth & section count (max 13 pts)
  if (headings.length >= 4) {
    headingStructure += 13;
    headingExplanation += `Article has strong scannability with ${headings.length} structured subheadings. `;
  } else if (headings.length >= 2) {
    headingStructure += 9;
    headingExplanation += `Article has good basic structure with ${headings.length} subheadings. `;
  } else if (headings.length === 1) {
    headingStructure += 5;
    headingExplanation += "Article has only one heading; breaking it into distinct sections would improve readability. ";
  } else {
    headingExplanation += "No subheadings found; content reads as a continuous block of text. ";
  }

  // Heading topical relevance (max 12 pts)
  if (keywordInHeadings) {
    headingStructure += 12;
    headingExplanation += "Subheadings directly incorporate the focus keyword and related phrasing.";
  } else if (partialTokenMatchesInHeadings) {
    headingStructure += 8;
    headingExplanation += "Subheadings incorporate relevant topical entities and focus areas.";
  } else if (headings.length > 0) {
    headingStructure += 4;
    headingExplanation += "Subheadings exist but would benefit from incorporating focus search terms.";
  }
  headingStructure = Math.min(25, headingStructure);

  // =========================================================================
  // Sub-score 3: Keyword Usage & Density (0-25)
  // Normalized for multi-word queries; avoids rewarding mechanical stuffing.
  // =========================================================================
  let keywordDensityScore = 0;
  let densityExplanation = "";

  if (totalEffectiveMatches === 0) {
    keywordDensityScore = 0;
    densityExplanation = "Target keyword was not found anywhere in the text (0 mentions).";
  } else {
    const isLongPhrase = keywordTokens.length >= 3;
    const rawDensity = totalWords > 0 ? (totalEffectiveMatches / totalWords) * 100 : 0;

    if (isLongPhrase) {
      // For multi-word queries (e.g. "how to grow tomatoes at home")
      if (totalEffectiveMatches >= 1 && totalEffectiveMatches <= 4) {
        keywordDensityScore = 25; // Natural, balanced keyword presence
        densityExplanation = `Optimal keyword presence: ${totalEffectiveMatches} natural mention(s) (${keywordDensityPercent}% exact density).`;
      } else if (totalEffectiveMatches === 5 || totalEffectiveMatches === 6) {
        keywordDensityScore = 20;
        densityExplanation = `Good natural presence (${totalEffectiveMatches} mentions); ensure wording remains conversational.`;
      } else if (totalEffectiveMatches > 6 && rawDensity > 2.0) {
        keywordDensityScore = 12; // Over-optimization penalty
        densityExplanation = `Warning: High keyword repetition (${totalEffectiveMatches} mentions) risks sounding repetitive.`;
      } else {
        keywordDensityScore = 22;
        densityExplanation = `Keyword appears naturally ${totalEffectiveMatches} time(s).`;
      }
    } else {
      // For 1-2 word keywords (e.g. "running shoes", "coffee", "budgeting")
      if (rawDensity >= 0.8 && rawDensity <= 2.5) {
        keywordDensityScore = 25;
        densityExplanation = `Optimal keyword density: ${rawDensity.toFixed(2)}% (${totalEffectiveMatches} mentions).`;
      } else if ((rawDensity >= 0.4 && rawDensity < 0.8) || (rawDensity > 2.5 && rawDensity <= 3.5)) {
        keywordDensityScore = 20;
        densityExplanation = `Good natural density: ${rawDensity.toFixed(2)}% (${totalEffectiveMatches} mentions).`;
      } else if (rawDensity > 3.5) {
        keywordDensityScore = 10;
        densityExplanation = `High keyword density (${rawDensity.toFixed(2)}%); replace some mentions with synonyms.`;
      } else {
        keywordDensityScore = 15;
        densityExplanation = `Light keyword density (${rawDensity.toFixed(2)}%).`;
      }
    }
  }

  // =========================================================================
  // Sub-score 4: Content Depth & Topical Breadth (0-25)
  // Considers search intent and usefulness rather than a rigid word-count rule.
  // =========================================================================
  let contentDepth = 0;
  let depthExplanation = "";

  if (intent === "Informational") {
    // Comprehensive tutorials benefit from 500-1000+ words
    if (totalWords >= 800) {
      contentDepth = 25;
      depthExplanation = `Comprehensive depth (${totalWords} words) thoroughly covers the user search query.`;
    } else if (totalWords >= 450) {
      contentDepth = 22;
      depthExplanation = `Good topical depth (${totalWords} words) providing solid practical guidance.`;
    } else if (totalWords >= 200) {
      contentDepth = 16;
      depthExplanation = `Concise practical overview (${totalWords} words); expanding with deeper examples will enhance coverage.`;
    } else if (totalWords >= 100) {
      contentDepth = 10;
      depthExplanation = `Brief overview (${totalWords} words); consider adding step-by-step guidance.`;
    } else {
      contentDepth = 4;
      depthExplanation = `Thin content (${totalWords} words); insufficient depth to compete for competitive search rankings.`;
    }
  } else {
    // Commercial, navigational, or concise answers
    if (totalWords >= 600) {
      contentDepth = 25;
      depthExplanation = `Thorough coverage (${totalWords} words) suited to ${intent.toLowerCase()} intent.`;
    } else if (totalWords >= 350) {
      contentDepth = 20;
      depthExplanation = `Clear, focused depth (${totalWords} words) answering user intent directly.`;
    } else if (totalWords >= 200) {
      contentDepth = 14;
      depthExplanation = `Concise content (${totalWords} words).`;
    } else {
      contentDepth = 6;
      depthExplanation = `Short content (${totalWords} words); more detail recommended.`;
    }
  }

  // Calculate final score
  const rawScore =
    keywordProminence + headingStructure + keywordDensityScore + contentDepth;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Rating
  let rating: ScoreContentResult["rating"];
  if (score >= 85) rating = "Excellent";
  else if (score >= 70) rating = "Good";
  else if (score >= 50) rating = "Needs Improvement";
  else rating = "Poor";

  // Actionable, prioritized recommendations grounded in the actual text
  const recommendations: string[] = [];

  if (!keywordInIntroduction) {
    if (introTokenOverlap > 0) {
      recommendations.push(
        `Mention your target keyword "${keyword}" or a close natural phrase in your opening paragraph to immediately clarify the page topic to readers.`
      );
    } else {
      recommendations.push(
        `Include your primary search query "${keyword}" within the first 100–150 words of your introduction to establish immediate topical relevance.`
      );
    }
  }

  if (headings.length === 0) {
    recommendations.push(
      `Add clear subheadings (H2, H3 or Markdown ##) to organize your article into scannable, logical sections.`
    );
  } else if (!keywordInHeadings) {
    recommendations.push(
      `Incorporate "${keyword}" or a natural topical variation into at least one prominent H2 subheading.`
    );
  }

  if (totalEffectiveMatches === 0) {
    recommendations.push(
      `The target keyword "${keyword}" is missing from the article. Weave it naturally throughout your content body.`
    );
  } else if (keywordDensityScore <= 10 && keywordMatches > 6) {
    recommendations.push(
      `Keyword frequency is high (${keywordMatches} exact occurrences). Replace some verbatim repetitions with natural synonyms to maintain readability and avoid over-optimization.`
    );
  } else if (totalEffectiveMatches === 1 && totalWords > 400) {
    recommendations.push(
      `Current keyword presence is light (1 mention across ${totalWords} words). Naturally mention the topic or its key components in your concluding section.`
    );
  }

  if (totalWords < 450 && intent === "Informational") {
    recommendations.push(
      `Your guide is currently ${totalWords} words. Expanding depth toward 600–900+ words with practical steps and troubleshooting advice will better fulfill user search intent.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      `Great job! Your content structure, keyword prominence, and depth are well-balanced for "${keyword}".`
    );
  }

  const breakdown: ScoreBreakdown = {
    keywordProminence,
    headingStructure,
    keywordDensity: keywordDensityScore,
    contentDepth,
    explanations: {
      keywordProminence: prominenceExplanation.trim(),
      headingStructure: headingExplanation.trim(),
      keywordDensity: densityExplanation.trim(),
      contentDepth: depthExplanation.trim(),
    },
  };

  const metrics: ContentMetrics = {
    characterCount,
    wordCount: totalWords,
    keywordCount: keywordMatches,
    keywordDensityPercent,
    headingCount: headings.length,
    keywordInHeadings,
    keywordInIntroduction,
    estimatedReadTimeMinutes: Math.max(1, Math.ceil(totalWords / 200)),
  };

  return {
    score,
    rating,
    keyword,
    metrics,
    breakdown,
    recommendations,
  };
}
