import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import http from "node:http";
import crypto from "node:crypto";
import { scoreContentAgainstKeyword } from "./engine/scorer.js";
import { suggestSemanticTerms } from "./engine/semantic.js";
import { rewriteMetaTags } from "./engine/meta.js";
import { nonEnglishContentError, keywordAbsentWarning } from "./validation.js";

// ─── Local Types ───────────────────────────────────────────────

export interface BlogOutlineSection {
  heading: string;
  level: "H2" | "H3";
  key_points: string[];
  estimated_words: number;
}

export interface BlogOutlineFaqItem {
  question: string;
  answer_summary: string;
}

export interface BlogOutlineResult {
  title: string;
  slug: string;
  target_keyword: string;
  target_audience: string;
  search_intent: string;
  estimated_reading_time_minutes: number;
  total_estimated_words: number;
  sections: BlogOutlineSection[];
  faq: BlogOutlineFaqItem[];
  seo_recommendations: {
    primary_keyword_placement: string[];
    suggested_meta_title: string;
    suggested_meta_description: string;
    semantic_keywords_to_include: string[];
  };
}

export interface PostInput {
  title: string;
  topic?: string;
}

export interface MetadataItem {
  index: number;
  original_title: string;
  seo_title: string;
  title_length: number;
  meta_description: string;
  description_length: number;
  slug: string;
  search_intent: "Informational" | "Commercial" | "Transactional" | "Navigational";
}

export interface BulkMetadataResult {
  total_processed: number;
  max_allowed: number;
  results: MetadataItem[];
}

export type WeekdayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface CalendarPost {
  week: number;
  day: WeekdayName;
  scheduled_date: string;
  keyword: string;
  suggested_title: string;
  content_format: string;
  primary_goal: string;
  distribution_channels: string[];
}

export interface ContentCalendarWeek {
  week_number: number;
  theme: string;
  posts: CalendarPost[];
}

export interface ContentCalendarResult {
  duration: "4 weeks";
  cadence: string;
  posts_per_week: number;
  total_posts: number;
  unique_keywords_covered: number;
  weeks: ContentCalendarWeek[];
  strategic_notes: string[];
}

// ─── Local Business Logic (No External APIs, No Paid Services) ─

/** Truncate to at most `max` characters (code points), appending "..." when cut. */
export function truncateTo(text: string, max: number): string {
  const chars = [...String(text)];
  if (chars.length <= max) return String(text);
  if (max <= 3) return chars.slice(0, max).join("");
  return chars.slice(0, max - 3).join("") + "...";
}

/**
 * URL-safe slug. Accents are folded (café -> cafe) instead of dropped, and
 * non-Latin input (e.g. Chinese) that would produce an empty slug falls back
 * to a deterministic hash so the slug is never empty.
 */
export function slugify(input: string, fallbackPrefix = "kw"): string {
  const folded = String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const base = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) return base;
  const hash = crypto.createHash("sha1").update(String(input), "utf8").digest("hex").slice(0, 8);
  return `${fallbackPrefix}-${hash}`;
}

/** Slug that is unique within a single result set (appends -2, -3, ...). */
export function makeUniqueSlug(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 1;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  used.add(candidate);
  return candidate;
}

export const WEEKDAY_NAMES: WeekdayName[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields (never shifts via UTC). */
export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generateBlogOutline(keyword: string, audience: string): BlogOutlineResult {
  const cleanKeyword = (keyword ?? "").trim();
  const cleanAudience = (audience ?? "").trim();
  if (!cleanKeyword) {
    throw new Error("Validation error: 'keyword' is required and must be a non-empty string.");
  }
  if (!cleanAudience) {
    throw new Error("Validation error: 'audience' is required and must be a non-empty string.");
  }

  const slug = slugify(cleanKeyword, "keyword");

  const capitalizedKeyword = cleanKeyword
    .split(/\s+/)
    .map((w) =>
      // Keep already-capitalized acronyms intact (SEO, FAQ, B2B) instead of
      // lowering them to "Seo"/"Faq"/"B2b".
      w.length <= 5 && w === w.toUpperCase() && /[A-Z]/.test(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");

  // SEO titles must stay <= 60 characters: try progressively shorter templates,
  // then hard-truncate as a last resort (keyword stays at the front).
  let title = `The Complete Guide to ${capitalizedKeyword} for ${cleanAudience}`;
  if ([...title].length > 60) {
    title = `${capitalizedKeyword} Guide for ${cleanAudience}`;
  }
  if ([...title].length > 60) {
    title = `${capitalizedKeyword} Guide`;
  }
  title = truncateTo(title, 60);

  // FAQ block — every question contains the target keyword verbatim so the
  // outline directly answers "what people also ask" style queries.
  const faq: BlogOutlineFaqItem[] = [
    {
      question: `What is ${cleanKeyword} and why should ${cleanAudience} care?`,
      answer_summary: `A working definition of ${cleanKeyword} and the concrete outcomes ${cleanAudience} can expect from it.`,
    },
    {
      question: `How long does it take to see results from ${cleanKeyword}?`,
      answer_summary: `A realistic timeline covering quick wins in the first 30 days and compounding results after 3 to 6 months.`,
    },
    {
      question: `What are the most common ${cleanKeyword} mistakes to avoid?`,
      answer_summary: `The pitfalls that waste the most time and budget, plus how to spot them early.`,
    },
    {
      question: `Which ${cleanKeyword} tools are best for ${cleanAudience}?`,
      answer_summary: `A shortlist of tools matched to budget and skill level, with guidance on when each one makes sense.`,
    },
    {
      question: `How much does ${cleanKeyword} cost to get started?`,
      answer_summary: `Typical costs from a free DIY setup to a managed approach, and what changes at each price point.`,
    },
  ];

  const sections: BlogOutlineSection[] = [
    {
      heading: `Introduction: The State of ${capitalizedKeyword}`,
      level: "H2",
      key_points: [
        `Hook: Why ${cleanKeyword} is critical for ${cleanAudience} today`,
        `Core problem statement and challenges faced by ${cleanAudience}`,
        `What this guide covers and actionable takeaways`,
      ],
      estimated_words: 250,
    },
    {
      heading: `Foundations: What Every ${cleanAudience} Needs to Know`,
      level: "H2",
      key_points: [
        `Clear definition of ${cleanKeyword}`,
        `Key terminology and fundamental principles`,
        `Common misconceptions debunked`,
      ],
      estimated_words: 350,
    },
    {
      heading: `Step-by-Step Implementation Framework`,
      level: "H2",
      key_points: [
        `Phase 1: Initial audit and baseline assessment`,
        `Phase 2: Setting up workflows tailored to ${cleanAudience}`,
        `Phase 3: Execution, monitoring, and quality control`,
      ],
      estimated_words: 500,
    },
    {
      heading: `Advanced Strategies & Best Practices`,
      level: "H2",
      key_points: [
        `High-impact tactics for optimizing ${cleanKeyword}`,
        `Time-saving shortcuts and automation opportunities`,
        `Case study or practical scenario walkthrough`,
      ],
      estimated_words: 400,
    },
    {
      heading: `5 Costly Pitfalls to Avoid`,
      level: "H2",
      key_points: [
        `Mistake #1: Skipping strategic groundwork`,
        `Mistake #2: Overcomplicating early implementation`,
        `Mistake #3: Neglecting ongoing measurement and feedback loops`,
      ],
      estimated_words: 300,
    },
    {
      heading: `Actionable Checklist & Next Steps`,
      level: "H2",
      key_points: [
        `Summary of core pillars`,
        `7-day quick start checklist for ${cleanAudience}`,
        `Final recommendation and next milestone`,
      ],
      estimated_words: 200,
    },
    {
      heading: `Frequently Asked Questions (FAQ)`,
      level: "H2",
      key_points: faq.map((f) => f.question),
      estimated_words: 300,
    },
  ];

  const totalWords = sections.reduce((acc, s) => acc + s.estimated_words, 0);

  return {
    title,
    slug,
    target_keyword: cleanKeyword,
    target_audience: cleanAudience,
    search_intent: "Informational & Practical How-To",
    estimated_reading_time_minutes: Math.ceil(totalWords / 200),
    total_estimated_words: totalWords,
    sections,
    faq,
    seo_recommendations: {
      primary_keyword_placement: [
        "Include primary keyword in H1 title and URL slug",
        "Place primary keyword within the first 100 words of the introduction",
        "Include primary keyword in at least two H2 subheadings",
        "Include primary keyword in the image alt text and conclusion",
      ],
      suggested_meta_title: truncateTo(`${capitalizedKeyword} for ${cleanAudience}: Step-by-Step Guide`, 60),
      suggested_meta_description: truncateTo(
        `Master ${cleanKeyword} with this comprehensive guide designed for ${cleanAudience}. Learn proven strategies, frameworks, and actionable tips.`,
        155
      ),
      semantic_keywords_to_include: [
        `${cleanKeyword} tips`,
        `best practices for ${cleanKeyword}`,
        `${cleanKeyword} strategy`,
        `${cleanKeyword} workflow`,
      ],
    },
  };
}

export function bulkGenerateMetadata(posts: PostInput[]): BulkMetadataResult {
  if (!Array.isArray(posts)) {
    throw new Error("Validation error: 'posts' is required and must be an array of post objects.");
  }
  if (posts.length > 20) {
    throw new Error(`Validation error: Cannot generate metadata for more than 20 posts at once. Received ${posts.length} posts. Maximum allowed is 20.`);
  }
  if (posts.length === 0) {
    throw new Error("Validation error: At least 1 post is required in the posts array.");
  }

  const usedSlugs = new Set<string>();

  const results: MetadataItem[] = posts.map((post, idx) => {
    if (!post || typeof post !== "object") {
      throw new Error(`Validation error: Post at index ${idx + 1} must be an object with a 'title' string.`);
    }
    if (typeof post.title !== "string" || !post.title.trim()) {
      throw new Error(`Validation error: Post at index ${idx + 1} must have a non-empty 'title' string. Received ${JSON.stringify(post.title ?? null)}.`);
    }
    if (post.topic !== undefined && typeof post.topic !== "string") {
      throw new Error(`Validation error: Post at index ${idx + 1} has an invalid 'topic' — expected a string. Received ${typeof post.topic}.`);
    }

    const rawTitle = post.title.trim();
    const topic = (post.topic ?? rawTitle).trim() || rawTitle;

    // Slug: accent-folded, always non-empty, unique across the whole batch
    // (duplicate titles get -2, -3, ... instead of colliding).
    const slug = makeUniqueSlug(slugify(rawTitle, "post"), usedSlugs);

    // Build SEO title (aim for 50-60 characters, never above 60)
    const suffixedTitle = `${rawTitle}: Complete Guide`;
    const seoTitle = [...suffixedTitle].length <= 60 ? suffixedTitle : truncateTo(rawTitle, 60);

    // Build meta description (aim for 145-155 characters, never above 155)
    const metaDescription = truncateTo(
      `Discover everything you need to know about ${topic}. Explore key strategies, practical tips, and expert recommendations in this comprehensive guide.`,
      155
    );

    // Detect search intent
    const lower = rawTitle.toLowerCase();
    let searchIntent: MetadataItem["search_intent"] = "Informational";
    if (lower.includes("buy") || lower.includes("price") || lower.includes("discount") || lower.includes("order")) {
      searchIntent = "Transactional";
    } else if (lower.includes("best") || lower.includes("vs") || lower.includes("review") || lower.includes("comparison")) {
      searchIntent = "Commercial";
    } else if (lower.includes("login") || lower.includes("portal") || lower.includes("homepage")) {
      searchIntent = "Navigational";
    }

    return {
      index: idx + 1,
      original_title: rawTitle,
      seo_title: seoTitle,
      title_length: seoTitle.length,
      meta_description: metaDescription,
      description_length: metaDescription.length,
      slug,
      search_intent: searchIntent,
    };
  });

  return {
    total_processed: results.length,
    max_allowed: 20,
    results,
  };
}

export function planContentCalendar(keywords: string[], postsPerWeek?: number): ContentCalendarResult {
  const inputKeywords: unknown[] = Array.isArray(keywords) ? keywords : [];
  if (inputKeywords.length === 0) {
    throw new Error("Validation error: At least 1 keyword is required to plan a content calendar.");
  }
  inputKeywords.forEach((k, i) => {
    if (typeof k !== "string") {
      throw new Error(
        `Validation error: keyword at position ${i + 1} must be a string. Received ${k === null ? "null" : typeof k}.`
      );
    }
  });
  const validKeywords = (inputKeywords as string[]).map((k) => k.trim()).filter((k) => k.length > 0);
  if (validKeywords.length === 0) {
    throw new Error("Validation error: At least 1 non-empty keyword is required to plan a content calendar.");
  }

  // posts_per_week: optional, default 3 (the documented Mon/Wed/Fri cadence).
  // Anything outside whole numbers 1..7 is rejected with a clear message —
  // e.g. 0 posts/week and 8 posts/week (more than a 7-day week allows).
  const resolved = postsPerWeek === undefined || postsPerWeek === null ? 3 : postsPerWeek;
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < 1 || resolved > 7) {
    throw new Error(
      `Validation error: 'posts_per_week' must be a whole number between 1 and 7. Received ${JSON.stringify(resolved)}.`
    );
  }
  const postsPerWeekValue = resolved;

  const formats = [
    { type: "Comprehensive In-Depth Guide", goal: "Establish topical authority and capture top-of-funnel organic search" },
    { type: "Actionable How-To Tutorial", goal: "Provide direct solutions to immediate user problems" },
    { type: "Best Practices & Industry Insights", goal: "Drive social shares, backlinks, and thought leadership" },
  ];

  const themes = [
    "Week 1: Core Fundamentals & Problem Awareness",
    "Week 2: Deep Dives & Practical Execution",
    "Week 3: Advanced Optimization & Workflow Hacks",
    "Week 4: Analysis, Pitfalls, & Long-Term Strategy",
  ];

  // Start on the NEXT Monday at local midnight. Dates are formatted from local
  // calendar fields (formatYmd), so they never shift a day via UTC conversion
  // and the weekday label always matches the real weekday.
  const now = new Date();
  const nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilMonday = (1 + 7 - now.getDay()) % 7 || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

  // Day slots: default cadence keeps the documented Mon/Wed/Fri rhythm; other
  // counts use the first N days of the week (1..7 => Mon .. Sun).
  const dayOffsets: number[] =
    postsPerWeekValue === 3 ? [0, 2, 4] : Array.from({ length: postsPerWeekValue }, (_, i) => i);
  const scheduledDayNames = dayOffsets.map((o) => WEEKDAY_NAMES[(nextMonday.getDay() + o) % 7]);

  let kwCounter = 0;
  // How many times each keyword has already been scheduled. Template selection
  // is driven by THIS counter (not the weekday index), so a keyword that
  // returns in a later week gets a fresh angle instead of an identical title —
  // e.g. with 2 posts/week over 4 keywords, "email marketing" lands on Monday
  // of week 1 AND week 3, and the old weekday-based pick repeated the title.
  const kwUsage = new Map<string, number>();
  const weeks: ContentCalendarWeek[] = [];

  for (let w = 0; w < 4; w++) {
    const weekPosts: CalendarPost[] = [];
    const weekStart = new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate() + w * 7);

    for (let i = 0; i < dayOffsets.length; i++) {
      const postDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayOffsets[i]);

      const kw = validKeywords[kwCounter % validKeywords.length];
      const fmt = formats[kwCounter % formats.length];
      kwCounter++;

      const capKw = kw.charAt(0).toUpperCase() + kw.slice(1);
      const titleTemplates = [
        `${capKw}: Everything You Need to Know in ${now.getFullYear()}`,
        `How to Master ${capKw} Step-by-Step`,
        `7 Best Practices for ${capKw} That Actually Work`,
      ];
      const use = kwUsage.get(kw) ?? 0;
      kwUsage.set(kw, use + 1);
      // After every template has been used for this keyword, add an editorial
      // "Part N" suffix. The suffix is subtracted from the 60-char budget
      // BEFORE truncation so long keywords can't clip it off and reintroduce
      // a duplicate.
      const part = Math.floor(use / titleTemplates.length);
      const suffix = part === 0 ? "" : ` (Part ${part + 1})`;
      const suggestedTitle =
        truncateTo(titleTemplates[use % titleTemplates.length], 60 - suffix.length) + suffix;

      weekPosts.push({
        week: w + 1,
        day: WEEKDAY_NAMES[postDate.getDay()],
        scheduled_date: formatYmd(postDate),
        keyword: kw,
        suggested_title: suggestedTitle,
        content_format: fmt.type,
        primary_goal: fmt.goal,
        distribution_channels: ["Organic Search (SEO)", "Email Newsletter", "Social Snippets"],
      });
    }

    weeks.push({
      week_number: w + 1,
      theme: themes[w],
      posts: weekPosts,
    });
  }

  const dayLabel = scheduledDayNames.join(", ");

  return {
    duration: "4 weeks",
    cadence: `${postsPerWeekValue} posts per week (${dayLabel})`,
    posts_per_week: postsPerWeekValue,
    total_posts: 4 * postsPerWeekValue,
    unique_keywords_covered: new Set(validKeywords).size,
    weeks,
    strategic_notes: [
      `Consistent ${postsPerWeekValue}x/week publishing cadence builds reader loyalty and signals active site maintenance to search engines.`,
      postsPerWeekValue === 3
        ? "Mondays focus on foundational guides, Wednesdays on practical execution, and Fridays on high-retention best practices."
        : `Publishing days (${dayLabel}) spread the keyword set evenly across all 4 weeks.`,
      "Repurpose high-performing guides into newsletter editions and social carousels 48 hours post-publication.",
    ],
  };
}

// ─── Setup MCP Server ──────────────────────────────────────────

/**
 * A fresh McpServer is created per connection/request.
 *
 * The MCP SDK's Protocol allows exactly ONE transport per server instance
 * ("Already connected to a transport"), and Streamable HTTP validates the
 * session on the transport that received initialize. Reusing one shared
 * server across requests made every request after the first fail — and two
 * concurrent SSE clients crashed the whole process with an unhandled
 * rejection. One server per connection removes both failure modes.
 */
export function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "content-seo-tools",
    version: "1.0.0",
  });

// MCP tool annotations, passed as the 4th argument to mcpServer.tool().
//
// ChatGPT's MCP reviewer scans for these and a missing readOnlyHint is the
// single most common rejection reason. read-only is accurate here, not a
// formality: all six tools take their inputs as arguments, compute purely in
// process, and return text. Nothing writes to disk, opens a socket, calls a
// third party, or reads environment state, so repeated calls with the same
// arguments always return the same result (idempotent) and nothing can be
// destroyed (destructiveHint false). openWorldHint is false for the same
// reason -- the tools never touch anything outside their own inputs.
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Tool 1: write a blog outline
mcpServer.tool(
  "generate_blog_outline",
  'write a blog outline — builds a structured blog post outline from a keyword and audience with section breakdowns and SEO tips',
  {
    keyword: z.string().min(1).describe("The primary keyword or topic for the blog post, e.g. 'local SEO'"),
    audience: z.string().min(1).describe("The target audience, e.g. 'freelance writers'"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ keyword, audience }) => {
    try {
      const data = generateBlogOutline(keyword, audience);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// Tool 2: generate meta descriptions for many posts
mcpServer.tool(
  "bulk_generate_metadata",
  'generate meta descriptions for many posts — writes SEO titles and meta descriptions for up to 20 posts at once',
  {
    posts: z
      .array(
        z.object({
          title: z.string().min(1).describe("The title of the blog post"),
          topic: z.string().optional().describe("Optional topic or focus keyword"),
        })
      )
      .min(1)
      .describe("List of posts (up to 20) with titles and optional topics"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ posts }) => {
    try {
      const data = bulkGenerateMetadata(posts);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);

// Tool 3: plan my content calendar
mcpServer.tool(
  "plan_content_calendar",
  'plan my content calendar — makes a 4-week posting schedule and content calendar from a list of keywords',
  {
    keywords: z
      .array(z.string())
      .min(1)
      .describe("List of keywords to populate into the 4-week schedule"),
    posts_per_week: z
      .number()
      .optional()
      .describe("Optional posts per week, whole number 1-7 (default 3 = Monday, Wednesday, Friday)"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ keywords, posts_per_week }) => {
    try {
      const data = planContentCalendar(keywords, posts_per_week);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      };
    }
  }
);
// Tool 4: score_content_against_keyword
mcpServer.tool(
  "score_content_against_keyword",
  "Analyze article text against a target search query to improve my content score. Use this when you want a number: it evaluates keyword density, heading placement, topical coverage, and content depth and returns a single 0-100 optimization score with actionable advice. For a list of missing words rather than a score, use suggest_semantic_terms.",
  {
    content: z.string().min(1).max(20000).describe("The article text to score"),
    keyword: z.string().min(1).max(200).describe("The target keyword, e.g. 'how to grow tomatoes at home'"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ content, keyword }) => {
    try {
      const err = nonEnglishContentError(content);
      if (err) return { isError: true, content: [{ type: "text" as const, text: `Validation Error: ${err}` }] };
      const warning = keywordAbsentWarning(content, keyword);
      const data = scoreContentAgainstKeyword(content, keyword);
      data.keywordFound = warning === null;
      if (warning) data.warnings = [warning];
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

// Tool 5: suggest_semantic_terms
mcpServer.tool(
  "suggest_semantic_terms",
  "Identify missing topical entities and find out what words am I missing to rank higher. Use this when you want a gap list: it compares the article against essential topical entities and returns two lists, terms already present and terms still missing, plus advice on where to add them. For an overall 0-100 number instead of a word list, use score_content_against_keyword.",
  {
    content: z.string().min(1).max(20000).describe("The article text to analyze for semantic coverage"),
    keyword: z.string().min(1).max(200).describe("The target search keyword"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ content, keyword }) => {
    try {
      const err = nonEnglishContentError(content);
      if (err) return { isError: true, content: [{ type: "text" as const, text: `Validation Error: ${err}` }] };
      const warning = keywordAbsentWarning(content, keyword);
      const data = suggestSemanticTerms(content, keyword);
      data.keywordFound = warning === null;
      if (warning) data.warnings = [warning];
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

// Tool 6: rewrite_meta_tags
mcpServer.tool(
  "rewrite_meta_tags",
  "Generate search-optimized metadata and rewrite my meta tags with high CTR hooks. Use this when you need the actual tag text to paste: it returns a meta title strictly under 60 characters and a meta description strictly under 155 characters in three variants. It never scores or analyzes body copy - use the other two tools for that.",
  {
    content: z.string().min(1).max(20000).describe("The article text to generate metadata for"),
    keyword: z.string().min(1).max(200).describe("The target search keyword"),
    site_name: z.string().optional().describe("Optional site name to append to the primary meta title"),
  },
  READ_ONLY_ANNOTATIONS,
  async ({ content, keyword, site_name }) => {
    try {
      const err = nonEnglishContentError(content);
      if (err) return { isError: true, content: [{ type: "text" as const, text: `Validation Error: ${err}` }] };
      const warning = keywordAbsentWarning(content, keyword);
      const data = rewriteMetaTags(content, keyword, site_name);
      data.keywordFound = warning === null;
      if (warning) data.warnings = [warning];
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

  return mcpServer;
}

// ─── Specifications (ChatGPT Plugin & OpenAPI) ─────────────────

// Single source of truth for the contact address. OpenAI requires a real,
// monitored support contact on the plugin manifest and the legal pages, so
// every one of them reads it from here -- change it in this one place.
// Exported so test-serverless.mjs can assert the pages and manifest agree
// with it instead of duplicating the literal.
export const SUPPORT_EMAIL = "PLACEHOLDER@gmail.com";

// Origin of the current request. The manifest and OpenAPI spec must advertise
// the public URL once deployed; they previously hardcoded localhost:3002, which
// is wrong the moment anyone else fetches them. TLS is terminated upstream on
// Vercel so https is always correct there; the local dev server is plain http.
function requestOrigin(req: http.IncomingMessage): string {
  const host = req.headers.host;
  if (!host) return "http://localhost:3002";
  return `${process.env.VERCEL ? "https" : "http"}://${host}`;
}

function buildPluginManifest(baseUrl: string) {
  return {
    schema_version: "v1",
    name_for_human: "Content & SEO Tools",
    name_for_model: "content_seo_tools",
    description_for_human: "Write blog outlines, generate meta descriptions for many posts, and plan your content calendar.",
    description_for_model:
      "Plugin providing 6 SEO and content creation tools. Use 'generate_blog_outline' to write a blog outline for a keyword and audience. Use 'bulk_generate_metadata' to generate meta descriptions for many posts (up to 20 posts). Use 'plan_content_calendar' to plan my content calendar for a 4-week posting schedule. Use 'score_content_against_keyword' to score existing content against a keyword. Use 'suggest_semantic_terms' to find missing semantic terms. Use 'rewrite_meta_tags' to rewrite meta tags with high CTR hooks.",
    auth: {
      type: "none",
    },
    api: {
      type: "openapi",
      url: `${baseUrl}/openapi.json`,
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: SUPPORT_EMAIL,
    legal_info_url: `${baseUrl}/privacy`,
  };
}

const OPENAPI_SPEC = {
  openapi: "3.0.1",
  info: {
    title: "Content & SEO Tools Plugin",
    description:
      "ChatGPT plugin for SEO tools: write a blog outline, generate meta descriptions for many posts, plan my content calendar, score content against a keyword, suggest missing semantic terms, and rewrite meta tags.",
    version: "v1",
  },
  servers: [
    {
      url: "http://localhost:3002",
    },
  ],
  paths: {
    "/generate_blog_outline": {
      post: {
        operationId: "generate_blog_outline",
        summary: "write a blog outline",
        description: "write a blog outline — builds a blog outline from a keyword and audience with section headings and SEO tips.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["keyword", "audience"],
                properties: {
                  keyword: {
                    type: "string",
                    description: "The target keyword or primary topic",
                    example: "email marketing",
                  },
                  audience: {
                    type: "string",
                    description: "The target audience reading the post",
                    example: "small business owners",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful outline generation",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
          "400": {
            description: "Invalid input",
          },
        },
      },
    },
    "/bulk_generate_metadata": {
      post: {
        operationId: "bulk_generate_metadata",
        summary: "generate meta descriptions for many posts",
        description: "generate meta descriptions for many posts — writes titles and descriptions for up to 20 posts at once.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["posts"],
                properties: {
                  posts: {
                    type: "array",
                    description: "List of posts (up to 20 posts)",
                    items: {
                      type: "object",
                      required: ["title"],
                      properties: {
                        title: { type: "string", example: "10 Email Tips" },
                        topic: { type: "string", example: "Email marketing" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful metadata generation",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
          "400": {
            description: "Validation error or exceeded 20 posts",
          },
        },
      },
    },
    "/plan_content_calendar": {
      post: {
        operationId: "plan_content_calendar",
        summary: "plan my content calendar",
        description: "plan my content calendar — makes a 4-week posting schedule from a list of keywords.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["keywords"],
                properties: {
                  keywords: {
                    type: "array",
                    description: "List of keywords to schedule across 4 weeks",
                    items: {
                      type: "string",
                    },
                    example: ["content marketing", "SEO tips", "social media growth"],
                  },
                  posts_per_week: {
                    type: "integer",
                    minimum: 1,
                    maximum: 7,
                    default: 3,
                    description:
                      "Optional. How many posts to schedule each week (whole number 1-7). Default 3 = Monday, Wednesday, Friday. Values of 0 or 8+ are rejected with a validation error.",
                    example: 3,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful content calendar plan",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
          "400": {
            description: "Invalid keywords list",
          },
        },
      },
    },
  },
};

// ─── Plugin Assets (the manifest references these — they must not 404) ──

// 64x64 placeholder logo (brand-blue tile with white text lines).
// Regenerate with: node scripts/gen-logo.mjs
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAcklEQVR42u3WQQ0AMAgDQMxMGfIRsUngwYvsmtTAfdo4WffnBgAAAAAAAAAAAAAAAAAAAACg7YYAAAAAAAAAABwhAAAAAABgBgEAAAAAAAAAjhAAAAAAANg9gwAAAAAAAAAARwgAAAAAAAAAAAAAAADjPoQwkeUXKNBEAAAAAElFTkSuQmCC",
  "base64"
);

// ─── Legal pages ──────────────────────────────────────────────
//
// OpenAI's submission form wants distinct URLs for the privacy policy, the
// terms of service, and a support contact. All three are built from one shell
// so they cannot drift apart stylistically, and they link to each other with
// relative paths so they work on any host. Every factual claim below matches
// how the server actually behaves: read-only tools, no accounts, no persistence
// of submitted text, no outbound calls.
const LEGAL_STYLE = `  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; max-width: 720px; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    h2 { font-size: 1.1rem; margin-top: 1.75rem; margin-bottom: 0.5rem; }
    li { margin-bottom: 0.5rem; }
    a { color: #7dd3fc; }
    .note { color: #94a3b8; font-size: 0.9rem; border-top: 1px solid #334155; padding-top: 1rem; margin-top: 1.5rem; }
    nav { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }
  </style>`;

function legalPage(title: string, bodyHtml: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Content &amp; SEO Tools</title>
${LEGAL_STYLE}
</head>
<body>
  <nav><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/support">Support</a></nav>
  <h1>${title}</h1>
${bodyHtml}
  <p class="note">Questions? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</body>
</html>`;
}

const PRIVACY_HTML = legalPage(
  "Privacy Policy",
  `  <p><strong>Content &amp; SEO Tools</strong> is a read-only MCP server. It generates blog outlines, metadata, content calendars, content scores, and meta tags from the text you send it.</p>
  <h2>What we receive</h2>
  <ul>
    <li>Only the arguments you pass to a tool: keywords, audiences, post titles, and article text.</li>
  </ul>
  <h2>What we do with it</h2>
  <ul>
    <li><strong>Processed in memory only.</strong> Your text is used to compute the response and is then discarded. It is not written to any database or file.</li>
    <li><strong>Not persisted.</strong> Each request is handled independently. Nothing links one request to another, and no session or account exists.</li>
    <li><strong>Never sold or shared.</strong> Submitted text is not sold, licensed, or shared with third parties.</li>
  </ul>
  <h2>What we do not do</h2>
  <ul>
    <li>No accounts, sign-up, or authentication of any kind.</li>
    <li>No cookies, no analytics, and no tracking of any sort.</li>
    <li>No outbound network calls. The server does not contact external APIs or paid services while handling your request.</li>
    <li>No storage of submitted content beyond the lifetime of the request.</li>
  </ul>
  <h2>Changes</h2>
  <p>This policy may be updated as the service changes. The current version always lives at this URL.</p>`,
);

const TERMS_HTML = legalPage(
  "Terms of Service",
  `  <p>By using <strong>Content &amp; SEO Tools</strong> you agree to these terms. If you do not agree, do not use the service.</p>
  <h2>What the service is</h2>
  <p>A free, read-only MCP server that generates SEO and content artifacts — blog outlines, meta descriptions, content calendars, content scores, semantic term suggestions, and rewritten meta tags — from text you provide.</p>
  <h2>Acceptable use</h2>
  <ul>
    <li>Do not use the service to generate unlawful, infringing, or harmful content.</li>
    <li>Do not attempt to disrupt, overload, or reverse engineer the service.</li>
    <li>You are responsible for the content you submit and for how you use the output.</li>
  </ul>
  <h2>Output is not professional advice</h2>
  <p>Scores, suggestions, and generated text are heuristic estimates produced by an automated tool. They are not SEO, legal, or marketing advice. Review all output before publishing it, and verify claims independently.</p>
  <h2>No warranty</h2>
  <p>The service is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement.</p>
  <h2>Limitation of liability</h2>
  <p>To the maximum extent permitted by law, the operator is not liable for any indirect, incidental, or consequential damages arising from use of the service, including lost profits, lost rankings, or lost data.</p>
  <h2>Changes</h2>
  <p>These terms may be updated as the service changes. Continued use after an update constitutes acceptance of the revised terms.</p>`,
);

const SUPPORT_HTML = legalPage(
  "Support",
  `  <p><strong>Content &amp; SEO Tools</strong> is free to use and requires no account.</p>
  <h2>Contact</h2>
  <p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> for any of the following:</p>
  <ul>
    <li>A tool returning an unexpected result</li>
    <li>A bug or an outage</li>
    <li>A question about how a tool works</li>
    <li>A privacy or data request</li>
  </ul>
  <h2>Before you write</h2>
  <ul>
    <li>The live health check is at <a href="/health">/health</a> — it lists every registered tool and confirms the server is up.</li>
    <li>Include the tool name and the arguments you used, with any sensitive text redacted.</li>
  </ul>
  <h2>Privacy and terms</h2>
  <p>See the <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.</p>`,
);

// Legacy hub, kept because the plugin manifest historically pointed here.
const LEGAL_HTML = legalPage(
  "Legal &amp; Privacy",
  `  <p>Legal information for <strong>Content &amp; SEO Tools</strong>.</p>
  <ul>
    <li><a href="/privacy">Privacy Policy</a> — what is received, what is done with it, and what is not done.</li>
    <li><a href="/terms">Terms of Service</a> — acceptable use, no-warranty and liability terms.</li>
    <li><a href="/support">Support</a> — how to report a problem or ask a question.</li>
  </ul>`,
);

// ─── Web UI (Interactive 3 Buttons Dashboard) ──────────────────

const HTML_UI = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChatGPT Plugin & MCP Server (Port 3002)</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --success: #4ade80;
      --danger: #f87171;
      --btn-bg: #2563eb;
      --btn-hover: #1d4ed8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 2rem 1rem;
      line-height: 1.5;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; color: #fff; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: #065f46;
      color: #34d399;
      margin-right: 0.5rem;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
    }
    .card h2 { font-size: 1.2rem; margin-bottom: 0.4rem; color: var(--primary); }
    .exact-phrase {
      font-size: 0.9rem;
      color: #facc15;
      background: #422006;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 0.8rem;
      font-family: monospace;
    }
    .card p { font-size: 0.88rem; color: var(--muted); margin-bottom: 1rem; flex-grow: 1; }
    .form-group { margin-bottom: 0.8rem; }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 0.25rem; }
    input, textarea {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: inherit;
    }
    .btn {
      background: var(--btn-bg);
      color: white;
      border: none;
      padding: 0.6rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: background 0.15s;
      width: 100%;
      margin-top: 0.4rem;
    }
    .btn:hover { background: var(--btn-hover); }
    .btn-danger { background: #b91c1c; }
    .btn-danger:hover { background: #991b1b; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--muted); margin-top: 0.4rem; }
    .btn-outline:hover { background: #334155; color: #fff; }
    #output-container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    #output-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    #output-title { font-weight: 600; font-size: 1rem; }
    pre {
      background: #0b0f19;
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.85rem;
      max-height: 450px;
      color: #38bdf8;
    }
    .endpoints { margin-top: 2rem; font-size: 0.85rem; color: var(--muted); }
    .endpoints code { background: #334155; padding: 0.1rem 0.3rem; border-radius: 3px; color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div style="margin-bottom: 0.5rem;">
        <span class="badge">LIVE: PORT 3002</span>
        <span class="badge" style="background: #1e3a8a; color: #93c5fd;">ChatGPT Plugin & MCP Server</span>
      </div>
      <h1>Content & SEO Automation Engine</h1>
      <p style="color: var(--muted); font-size: 0.95rem;">
        3 native buttons designed using the exact phrases people type into ChatGPT. 100% local execution.
      </p>
    </header>

    <div class="grid">
      <!-- BUTTON 1 -->
      <div class="card">
        <h2>1. generate_blog_outline</h2>
        <div class="exact-phrase">"write a blog outline"</div>
        <p>Builds a comprehensive blog outline with section headings, word counts, and actionable SEO guidance.</p>
        <div class="form-group">
          <label>Keyword</label>
          <input type="text" id="bo-kw" value="email marketing">
        </div>
        <div class="form-group">
          <label>Audience</label>
          <input type="text" id="bo-aud" value="small business owners">
        </div>
        <button class="btn" onclick="runOutline()">Button 1: write a blog outline</button>
      </div>

      <!-- BUTTON 2 -->
      <div class="card">
        <h2>2. bulk_generate_metadata</h2>
        <div class="exact-phrase">"generate meta descriptions for many posts"</div>
        <p>Writes SEO titles and meta descriptions for up to 20 posts at once. Enforces strict &le; 20 boundary.</p>
        <div class="form-group">
          <label>Posts (JSON array of {title, topic})</label>
          <textarea id="bg-posts" rows="4">[
  {"title": "How to Start an Email Newsletter", "topic": "Newsletter strategy"},
  {"title": "Top 10 Welcome Email Templates", "topic": "Email templates"},
  {"title": "Email Deliverability Checklist", "topic": "Inbox placement"}
]</textarea>
        </div>
        <button class="btn" onclick="runMetadata()">Button 2: generate meta descriptions</button>
        <button class="btn btn-danger" onclick="runBadMetadata21()">Test Bad Input: Send 21 Posts</button>
      </div>

      <!-- BUTTON 3 -->
      <div class="card">
        <h2>3. plan_content_calendar</h2>
        <div class="exact-phrase">"plan my content calendar"</div>
        <p>Creates a 4-week publishing schedule (default Mon/Wed/Fri = 12 posts, adjustable 1&ndash;7 posts per week) with rotation themes from keywords.</p>
        <div class="form-group">
          <label>Keywords (comma-separated)</label>
          <input type="text" id="pc-kws" value="email marketing, SEO tips, lead generation, conversion rate">
        </div>
        <div class="form-group">
          <label>Posts per week (1&ndash;7, default 3)</label>
          <input type="number" id="pc-ppw" min="1" max="7" step="1" value="3">
        </div>
        <button class="btn" onclick="runCalendar()">Button 3: plan my content calendar</button>
        <button class="btn btn-outline" onclick="runBadCalendar()">Test Bad Input: Empty Keywords</button>
        <button class="btn btn-outline" onclick="runBadPostsPerWeek()">Test Bad Input: 0 Posts/Week</button>
      </div>
    </div>

    <div id="output-container">
      <div id="output-header">
        <span id="output-title">Live Response Output</span>
        <span id="output-status" style="font-size: 0.85rem; color: var(--muted);">Ready</span>
      </div>
      <pre id="output-pre">// Click any button above or send a POST request to see the live output.</pre>
    </div>

    <div class="endpoints">
      <p>Endpoints:
        <code>GET /.well-known/ai-plugin.json</code> |
        <code>GET /openapi.json</code> |
        <code>GET /logo.png</code> |
        <code>GET /legal</code> |
        <code>POST /mcp</code> |
        <code>GET /sse</code> |
        <code>GET /health</code>
      </p>
    </div>
  </div>

  <script>
    const pre = document.getElementById('output-pre');
    const status = document.getElementById('output-status');

    async function makeCall(url, body) {
      status.textContent = 'Executing...';
      pre.textContent = 'Calling ' + url + '...';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        status.textContent = 'HTTP ' + res.status + ' ' + (res.ok ? 'OK' : 'Error');
        pre.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        status.textContent = 'Network Error';
        pre.textContent = e.message;
      }
    }

    function runOutline() {
      const keyword = document.getElementById('bo-kw').value;
      const audience = document.getElementById('bo-aud').value;
      makeCall('/generate_blog_outline', { keyword, audience });
    }

    function runMetadata() {
      try {
        const posts = JSON.parse(document.getElementById('bg-posts').value);
        makeCall('/bulk_generate_metadata', { posts });
      } catch (e) {
        alert('Invalid JSON in posts input: ' + e.message);
      }
    }

    function runBadMetadata21() {
      const posts21 = [];
      for (let i = 1; i <= 21; i++) {
        posts21.push({ title: 'Test Post #' + i, topic: 'Topic ' + i });
      }
      makeCall('/bulk_generate_metadata', { posts: posts21 });
    }

    function runCalendar() {
      const raw = document.getElementById('pc-kws').value;
      const keywords = raw.split(',').map(s => s.trim()).filter(Boolean);
      const rawPpw = document.getElementById('pc-ppw').value.trim();
      const postsPerWeek = rawPpw === '' ? 3 : Number(rawPpw);
      makeCall('/plan_content_calendar', { keywords, posts_per_week: postsPerWeek });
    }

    function runBadCalendar() {
      makeCall('/plan_content_calendar', { keywords: [] });
    }

    function runBadPostsPerWeek() {
      const raw = document.getElementById('pc-kws').value;
      const keywords = raw.split(',').map(s => s.trim()).filter(Boolean);
      makeCall('/plan_content_calendar', { keywords: keywords.length ? keywords : ['seo tips'], posts_per_week: 0 });
    }
  </script>
</body>
</html>`;

// ─── HTTP Server (Port 3002) ───────────────────────────────────

const PORT = 3002;

const sseTransports = new Map<string, SSEServerTransport>();

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Protection against massive payload
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON in request body"));
      }
    });
    req.on("error", reject);
  });
}

// Exported so the Vercel serverless entry (api/index.ts) can route every
// request through the same handler. Signature is a plain Node (req, res)
// pair, which is exactly what @vercel/node accepts.
export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost:3002"}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Interactive UI
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_UI);
    return;
  }

  // 2. Health check
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        port: PORT,
        server: "content-seo-tools",
        uptime_seconds: process.uptime(),
        tools: [
          { name: "generate_blog_outline", phrase: "write a blog outline" },
          { name: "bulk_generate_metadata", phrase: "generate meta descriptions for many posts" },
          { name: "plan_content_calendar", phrase: "plan my content calendar" },
          { name: "score_content_against_keyword", phrase: "improve my content score" },
          { name: "suggest_semantic_terms", phrase: "what words am I missing to rank higher" },
          { name: "rewrite_meta_tags", phrase: "rewrite my meta tags with high CTR hooks" },
        ],
      })
    );
    return;
  }

  // 3. ChatGPT Plugin Manifest
  if (req.method === "GET" && pathname === "/.well-known/ai-plugin.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(buildPluginManifest(requestOrigin(req)), null, 2));
    return;
  }

  // 4. OpenAPI Specs
  if (req.method === "GET" && pathname === "/openapi.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    // Override the servers entry with the live origin so the spec points at
    // this deployment rather than the local dev port.
    res.end(JSON.stringify({ ...OPENAPI_SPEC, servers: [{ url: requestOrigin(req) }] }, null, 2));
    return;
  }

  // 4b. Plugin logo (logo_url in the manifest)
  if (req.method === "GET" && pathname === "/logo.png") {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": LOGO_PNG.length, "Cache-Control": "public, max-age=3600" });
    res.end(LOGO_PNG);
    return;
  }

  // 4b-2. Favicon (browsers auto-request /favicon.ico on every page load; a 404
  // there floods the console with errors). PNG bytes are valid favicon data,
  // so reuse the plugin logo instead of shipping a second asset.
  if (req.method === "GET" && pathname === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": LOGO_PNG.length, "Cache-Control": "public, max-age=3600" });
    res.end(LOGO_PNG);
    return;
  }

  // 4c. Legal info page (legal_info_url in the manifest)
  if (req.method === "GET" && pathname === "/legal") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(LEGAL_HTML);
    return;
  }

  // 4d. The three distinct legal URLs OpenAI's submission form asks for:
  // privacy_policy_url, terms_of_service_url, and a support contact page.
  if (req.method === "GET" && pathname === "/privacy") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PRIVACY_HTML);
    return;
  }
  if (req.method === "GET" && pathname === "/terms") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(TERMS_HTML);
    return;
  }
  if (req.method === "GET" && pathname === "/support") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SUPPORT_HTML);
    return;
  }

  // 5. REST & Plugin Action: generate_blog_outline ("write a blog outline")
  if (req.method === "POST" && (pathname === "/generate_blog_outline" || pathname === "/api/generate_blog_outline")) {
    try {
      const body = await parseJsonBody(req);
      const { keyword, audience } = body;
      if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'keyword' is required and must be a non-empty string." }));
        return;
      }
      if (!audience || typeof audience !== "string" || !audience.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'audience' is required and must be a non-empty string." }));
        return;
      }
      const result = generateBlogOutline(keyword, audience);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 6. REST & Plugin Action: bulk_generate_metadata ("generate meta descriptions for many posts")
  if (req.method === "POST" && (pathname === "/bulk_generate_metadata" || pathname === "/api/bulk_generate_metadata")) {
    try {
      const body = await parseJsonBody(req);
      const { posts } = body;
      if (!posts || !Array.isArray(posts)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'posts' is required and must be an array of post objects." }));
        return;
      }
      const result = bulkGenerateMetadata(posts);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7. REST & Plugin Action: plan_content_calendar ("plan my content calendar")
  if (req.method === "POST" && (pathname === "/plan_content_calendar" || pathname === "/api/plan_content_calendar")) {
    try {
      const body = await parseJsonBody(req);
      const { keywords, posts_per_week } = body;
      if (!keywords || !Array.isArray(keywords)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'keywords' is required and must be an array of strings." }));
        return;
      }
      const result = planContentCalendar(keywords, posts_per_week);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7b. REST Action: score_content_against_keyword
  if (req.method === "POST" && (pathname === "/score_content_against_keyword" || pathname === "/api/score-content" || pathname === "/api/score_content_against_keyword")) {
    try {
      const body = await parseJsonBody(req);
      const { content, keyword } = body;
      if (!content || typeof content !== "string" || !content.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'content' is required and must be a non-empty string." }));
        return;
      }
      if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'keyword' is required and must be a non-empty string." }));
        return;
      }
      const langErr = nonEnglishContentError(content);
      if (langErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: langErr }));
        return;
      }
      const warning = keywordAbsentWarning(content, keyword);
      const result = scoreContentAgainstKeyword(content, keyword);
      result.keywordFound = warning === null;
      if (warning) result.warnings = [warning];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7c. REST Action: suggest_semantic_terms
  if (req.method === "POST" && (pathname === "/suggest_semantic_terms" || pathname === "/api/suggest-terms" || pathname === "/api/suggest_semantic_terms")) {
    try {
      const body = await parseJsonBody(req);
      const { content, keyword } = body;
      if (!content || typeof content !== "string" || !content.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'content' is required and must be a non-empty string." }));
        return;
      }
      if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'keyword' is required and must be a non-empty string." }));
        return;
      }
      const langErr = nonEnglishContentError(content);
      if (langErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: langErr }));
        return;
      }
      const warning = keywordAbsentWarning(content, keyword);
      const result = suggestSemanticTerms(content, keyword);
      result.keywordFound = warning === null;
      if (warning) result.warnings = [warning];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7d. REST Action: rewrite_meta_tags
  if (req.method === "POST" && (pathname === "/rewrite_meta_tags" || pathname === "/api/rewrite-meta" || pathname === "/api/rewrite_meta_tags")) {
    try {
      const body = await parseJsonBody(req);
      const { content, keyword, site_name } = body;
      if (!content || typeof content !== "string" || !content.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'content' is required and must be a non-empty string." }));
        return;
      }
      if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Validation error: 'keyword' is required and must be a non-empty string." }));
        return;
      }
      const langErr = nonEnglishContentError(content);
      if (langErr) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: langErr }));
        return;
      }
      const warning = keywordAbsentWarning(content, keyword);
      const result = rewriteMetaTags(content, keyword, site_name);
      result.keywordFound = warning === null;
      if (warning) result.warnings = [warning];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 8. MCP Streamable HTTP endpoint (stateless: one server + transport per request)
  //
  // The SDK rejects any non-initialize request whose session was not
  // initialized on THAT transport ("Bad Request: Server not initialized"), so
  // a new transport per request must run without session management. Session
  // ids are optional in MCP, so clients fall back to session-less requests.
  if (pathname === "/mcp") {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const server = createMcpServer();

      res.on("close", () => {
        transport.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "MCP Error: " + err.message }));
      }
      return;
    }
  }

  // 9. MCP SSE endpoint (one dedicated server per SSE connection)
  if (pathname === "/sse" && req.method === "GET") {
    try {
      const transport = new SSEServerTransport("/messages", res);
      const server = createMcpServer();
      sseTransports.set(transport.sessionId, transport);
      await server.connect(transport);

      req.on("close", () => {
        sseTransports.delete(transport.sessionId);
        transport.close().catch(() => {});
      });
      return;
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "MCP SSE Error: " + err.message }));
      }
      return;
    }
  }

  if (pathname === "/messages" && req.method === "POST") {
    const sessionId = parsedUrl.searchParams.get("sessionId");
    if (!sessionId || !sseTransports.has(sessionId)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    try {
      const transport = sseTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "MCP Message Error: " + err.message }));
      }
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Endpoint not found",
      available_endpoints: [
        "/",
        "/health",
        "/.well-known/ai-plugin.json",
        "/openapi.json",
        "/logo.png",
        "/legal",
        "/generate_blog_outline",
        "/bulk_generate_metadata",
        "/plan_content_calendar",
        "/mcp",
        "/sse",
      ],
    })
  );
}

// Any rejection inside the request handler is turned into a 500 response
// instead of an unhandled rejection, which would kill the whole process.
//
// On Vercel the serverless entry imports handleRequest directly and no socket
// is bound here — binding at import time would hang the function. VERCEL is set
// automatically by the platform; locally it is unset, so `npm start` is
// unchanged.
export const httpServer = http.createServer((req, res) => {
  handleRequest(req, res).catch((err: any) => {
    console.error("Unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error: " + (err?.message ?? String(err)) }));
    } else {
      try {
        res.end();
      } catch {
        /* connection already gone */
      }
    }
  });
});

if (!process.env.VERCEL) {
  httpServer.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 ChatGPT Plugin & MCP Server running on port ${PORT}`);
  console.log(`   Interactive Web UI : http://localhost:${PORT}/`);
  console.log(`   Health Check       : http://localhost:${PORT}/health`);
  console.log(`   ChatGPT Manifest   : http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`   OpenAPI Spec       : http://localhost:${PORT}/openapi.json`);
  console.log(`   MCP Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`   MCP SSE Transport  : http://localhost:${PORT}/sse`);
  console.log(`----------------------------------------------------`);
  console.log(`Buttons & Exact SEO Phrases:`);
  console.log(` 1. generate_blog_outline -> "write a blog outline"`);
  console.log(` 2. bulk_generate_metadata -> "generate meta descriptions for many posts"`);
  console.log(` 3. plan_content_calendar -> "plan my content calendar"`);
  console.log(`====================================================`);
  });
}
