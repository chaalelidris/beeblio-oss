import type { CitationReference } from "../citations";

/**
 * Evidence Verification classification adhering to research and peer-review rigor.
 * Distinguishes supported findings from genuine lack of support, incomplete retrieval,
 * and inaccessible or unverifiable reference materials.
 */
export type EvidenceVerificationLabel =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "RELATED_BUT_UNSUPPORTED"
  | "UNSUPPORTED"
  | "UNVERIFIABLE"
  | "INCOMPLETE_RETRIEVAL"
  | "CONTRADICTED"
  | "INSUFFICIENT_CONTEXT";

/**
 * Final citation action recommendation synthesized from retrieval, verifier, and consistency checks.
 */
export type CitationRecommendation =
  | "RECOMMEND"
  | "PARTIAL_SUPPORT"
  | "REJECT"
  | "NEEDS_REVIEW";

/**
 * Surrounding context from the user's active draft document.
 * Enables discourse anaphora resolution and section-aware grounding.
 */
export type DraftContext = {
  precedingText?: string;
  succeedingText?: string;
  sectionHeading?: string;
  paragraphText?: string;
};

/**
 * Granular verdict for an individual subclaim or scientific assertion.
 */
export type ClaimVerdict = {
  claimText: string;
  label: EvidenceVerificationLabel;
  supported: boolean;
  exactQuote?: string;
  pageNumber?: number;
  sourceLocation?: string;
  evidenceExcerpt?: string;
  neighboringContext?: string;
  reasoning: string;
};

/**
 * Structured scientific claim extraction (Stage A).
 */
export type ClaimDecomposition = {
  originalClaim: string;
  mainClaim: string;
  subclaims: string[];
  entities: string[];
  contextEntities?: string[];
  numericalValues: Array<{
    raw: string;
    value: number;
    unit?: string;
    operator?: string;
    min?: number;
    max?: number;
  }>;
  hasCausalClaim: boolean;
  causalMarkers: string[];
  isComparative: boolean;
  claimCategory:
    | "empirical_result"
    | "method"
    | "background"
    | "causal_explanation"
    | "statistical";
  conditionsAndLimitations: string[];
};

/**
 * Candidate evidence passage with full provenance and context (Stage B).
 */
export type EvidencePassage = {
  id: string;
  citationKey: string;
  reference: CitationReference;
  text: string;
  neighboringContext?: string;
  sourceLocation: string; // e.g. "Page 4", "Section 3.2", "Abstract"
  sourceFilePath?: string;
  sourceFileName?: string;
  pageNumber?: number;
  section?: string;
  doi?: string;
  retrievalScore: number;
  rerankScore?: number;
  isSecondaryCitation?: boolean;
  secondaryCitationRef?: string;
  // Full source document provenance when accessible
  fullSourceAvailable?: boolean;
  fullSourceText?: string;
  fullSourcePages?: Array<{ pageNumber: number; paragraphs: string[]; text?: string }>;
};

/**
 * Consistency validation report (Stage E).
 */
export type ConsistencyReport = {
  passed: boolean;
  numericalMatch: boolean;
  unitMatch: boolean;
  causalityMatch: boolean;
  polarityMatch: boolean;
  discrepancies: string[];
  warnings: string[];
};

/**
 * Result of claim–evidence verification (Stage D).
 */
export type VerificationResult = {
  label: EvidenceVerificationLabel;
  supportedSubclaims: string[];
  unsupportedSubclaims: string[];
  contradictedSubclaims: string[];
  exactQuote: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  abstained: boolean;
  abstentionReason?: string;
  pageNumber?: number;
  sourceLocation?: string;
  neighboringContext?: string;
  claimVerdicts?: ClaimVerdict[];
  supportingPassages?: Array<{ quote: string; pageNumber?: number; sourceLocation?: string }>;
};

/**
 * Complete, explainable citation match combining all pipeline stages.
 */
export type VerifiedCitationMatch = {
  citationKey: string;
  reference: CitationReference;
  originalClaim: string;
  evidenceExcerpt: string;
  sourceLocation: string;
  sourceFilePath?: string;
  sourceFileName?: string;
  pageNumber?: number;
  retrievalScore: number;
  rerankScore?: number;
  verificationLabel: EvidenceVerificationLabel;
  supportedSubclaims: string[];
  unsupportedSubclaims: string[];
  contradictedSubclaims: string[];
  claimVerdicts?: ClaimVerdict[];
  supportingPassages?: Array<{ quote: string; pageNumber?: number; sourceLocation?: string }>;
  discrepancies: string[];
  reasoning: string;
  recommendation: CitationRecommendation;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  abstained: boolean;
  abstentionReason?: string;
  isSecondaryCitation?: boolean;
  secondaryCitationRef?: string;
  // Backward compatibility with CitationFindMatch for TipTap & existing UI
  originalText: string;
  explanation: string;
  score: number;
};

/**
 * API return contract for findCitationForSelection.
 */
export type VerifiedCitationResult =
  | {
      found: true;
      matches: VerifiedCitationMatch[];
      match: VerifiedCitationMatch;
      pipelineStageSummary?: string;
    }
  | {
      found: false;
      message: string;
    };
