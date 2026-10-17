import { z } from "zod";

// Hard rule: 20,000 character maximum cap on input content
export const MAX_CONTENT_LENGTH = 20000;
export const MAX_KEYWORD_LENGTH = 200;

export const ScoreContentInputSchema = z.object({
  content: z
    .string({
      required_error: "Content is required",
      invalid_type_error: "Content must be a string",
    })
    .trim()
    .min(1, "Content cannot be empty")
    .max(
      MAX_CONTENT_LENGTH,
      `Content exceeds maximum character limit of ${MAX_CONTENT_LENGTH.toLocaleString()} characters`
    ),
  keyword: z
    .string({
      required_error: "Keyword is required",
      invalid_type_error: "Keyword must be a string",
    })
    .trim()
    .min(1, "Keyword cannot be empty")
    .max(
      MAX_KEYWORD_LENGTH,
      `Keyword exceeds maximum character limit of ${MAX_KEYWORD_LENGTH} characters`
    ),
});

export type ScoreContentInput = z.infer<typeof ScoreContentInputSchema>;

export const SuggestSemanticTermsInputSchema = z.object({
  content: z
    .string({
      required_error: "Content is required",
      invalid_type_error: "Content must be a string",
    })
    .trim()
    .min(1, "Content cannot be empty")
    .max(
      MAX_CONTENT_LENGTH,
      `Content exceeds maximum character limit of ${MAX_CONTENT_LENGTH.toLocaleString()} characters`
    ),
  keyword: z
    .string({
      required_error: "Keyword is required",
      invalid_type_error: "Keyword must be a string",
    })
    .trim()
    .min(1, "Keyword cannot be empty")
    .max(
      MAX_KEYWORD_LENGTH,
      `Keyword exceeds maximum character limit of ${MAX_KEYWORD_LENGTH} characters`
    ),
});

export type SuggestSemanticTermsInput = z.infer<typeof SuggestSemanticTermsInputSchema>;

export const RewriteMetaTagsInputSchema = z.object({
  content: z
    .string({
      required_error: "Content is required",
      invalid_type_error: "Content must be a string",
    })
    .trim()
    .min(1, "Content cannot be empty")
    .max(
      MAX_CONTENT_LENGTH,
      `Content exceeds maximum character limit of ${MAX_CONTENT_LENGTH.toLocaleString()} characters`
    ),
  keyword: z
    .string({
      required_error: "Keyword is required",
      invalid_type_error: "Keyword must be a string",
    })
    .trim()
    .min(1, "Keyword cannot be empty")
    .max(
      MAX_KEYWORD_LENGTH,
      `Keyword exceeds maximum character limit of ${MAX_KEYWORD_LENGTH} characters`
    ),
  site_name: z
    .string()
    .trim()
    .max(60, "Site name cannot exceed 60 characters")
    .optional(),
});

export type RewriteMetaTagsInput = z.infer<typeof RewriteMetaTagsInputSchema>;

export interface ScoreBreakdown {
  keywordProminence: number; // 0-25
  headingStructure: number; // 0-25
  keywordDensity: number; // 0-25
  contentDepth: number; // 0-25
  explanations?: {
    keywordProminence: string;
    headingStructure: string;
    keywordDensity: string;
    contentDepth: string;
  };
}

export interface ContentMetrics {
  characterCount: number;
  wordCount: number;
  keywordCount: number;
  keywordDensityPercent: number;
  headingCount: number;
  keywordInHeadings: boolean;
  keywordInIntroduction: boolean;
  estimatedReadTimeMinutes: number;
}

export interface ScoreContentResult {
  score: number; // 0-100
  rating: "Poor" | "Needs Improvement" | "Good" | "Excellent";
  keyword: string;
  /** False when the keyword does not appear in the content (best-effort result, see warnings). */
  keywordFound?: boolean;
  /** Best-effort notices (e.g. keyword absent from content). Absent on the happy path. */
  warnings?: string[];
  metrics: ContentMetrics;
  breakdown: ScoreBreakdown;
  recommendations: string[];
}

export interface SemanticTermItem {
  term: string;
  category: "core-entity" | "intent-driver" | "supporting-attribute";
  relevance: "high" | "medium";
  count?: number;
  reason?: string;
}

export interface SuggestSemanticTermsResult {
  keyword: string;
  /** False when the keyword does not appear in the content (best-effort result, see warnings). */
  keywordFound?: boolean;
  /** Best-effort notices (e.g. keyword absent from content). Absent on the happy path. */
  warnings?: string[];
  totalTermsEvaluated: number;
  presentTermsCount: number;
  missingTermsCount: number;
  presentTerms: SemanticTermItem[];
  missingTerms: SemanticTermItem[];
  actionableAdvice: string[];
}

export interface MetaTagSet {
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  variant: "primary" | "high-ctr" | "benefit-focused";
}

export interface RewriteMetaTagsResult {
  keyword: string;
  /** False when the keyword does not appear in the content (best-effort result, see warnings). */
  keywordFound?: boolean;
  /** Best-effort notices (e.g. keyword absent from content). Absent on the happy path. */
  warnings?: string[];
  metaTags: MetaTagSet[];
  validation: {
    maxTitleLimit: 60;
    maxDescriptionLimit: 155;
    allTitlesCompliant: boolean;
    allDescriptionsCompliant: boolean;
  };
}
