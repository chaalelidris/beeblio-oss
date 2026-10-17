import { extractScientificClaim } from "./claim-extractor";
import { retrieveCandidateEvidence } from "./retrieval";
import { rerankCandidates } from "./reranker";
import { checkDeterministicConsistency } from "./consistency-checker";
import { verifyClaimEvidence } from "./claim-verifier";
import { buildVerifiedCitationMatch } from "./decision-engine";
import type {
  ClaimDecomposition,
  VerifiedCitationMatch,
  VerifiedCitationResult,
  DraftContext,
} from "./types";

export * from "./types";
export * from "./claim-extractor";
export * from "./retrieval";
export * from "./reranker";
export * from "./consistency-checker";
export * from "./claim-verifier";
export * from "./decision-engine";

export type VerificationPipelineOptions = {
  maxCandidates?: number;
  aiApiKey?: string;
  aiModelId?: string;
  forceDeterministicOnly?: boolean;
  context?: DraftContext;
};

/**
 * Executes the complete multi-stage evidence verification pipeline:
 * Stage A (Claim Decomposition)
 * -> Stage B (Passage-level Retrieval)
 * -> Stage C (Alignment Reranking)
 * -> Stage E (Deterministic Consistency Checks)
 * -> Stage D (Entailment Verification)
 * -> Stage F (Citation Decision Engine)
 */
export async function runCitationVerificationPipeline(
  userId: string,
  projectSlug: string,
  claimText: string,
  options?: VerificationPipelineOptions,
): Promise<VerifiedCitationResult> {
  const trimmed = claimText.trim();
  if (!trimmed) {
    return {
      found: false,
      message: "No scientific claim or text was provided for verification.",
    };
  }

  // Stage A: Decompose Claim (with context-aware anaphora resolution)
  const decomposition: ClaimDecomposition = extractScientificClaim(trimmed, options?.context);

  // Stage B: Retrieve Passages (with discourse-aware token expansion)
  const { passages } = await retrieveCandidateEvidence(
    userId,
    projectSlug,
    trimmed,
    {
      maxCandidates: options?.maxCandidates ?? 10,
      context: options?.context,
    },
  );

  if (passages.length === 0) {
    return {
      found: false,
      message:
        "No relevant candidate passages were found in the bibliography or reference documents.",
    };
  }

  // Stage C: Rerank Passages based on claim components
  const reranked = rerankCandidates(decomposition, passages);
  const candidatesToVerify = reranked.slice(0, 3);

  // Stages D, E, F: Verify, Check Consistency, and Form Decision in parallel
  const matchPromises = candidatesToVerify.map(async (passage) => {
    // Stage E: Deterministic Consistency Checks
    const consistency = checkDeterministicConsistency(decomposition, passage.text);

    // Stage D: Entailment Verification
    const verification = await verifyClaimEvidence(
      decomposition,
      passage,
      consistency,
      options?.forceDeterministicOnly
        ? undefined
        : {
            apiKey: options?.aiApiKey,
            modelId: options?.aiModelId,
          },
    );

    // Stage F: Decision Synthesis
    return buildVerifiedCitationMatch(
      decomposition,
      passage,
      verification,
      consistency,
    );
  });

  const matches: VerifiedCitationMatch[] = await Promise.all(matchPromises);

  if (matches.length === 0) {
    return {
      found: false,
      message:
        "Retrieved passages were insufficient to verify or support this scientific claim.",
    };
  }

  // Sort matches prioritizing verified RECOMMEND first, then PARTIAL_SUPPORT, then NEEDS_REVIEW, then REJECT
  const priorityOrder: Record<string, number> = {
    RECOMMEND: 4,
    PARTIAL_SUPPORT: 3,
    NEEDS_REVIEW: 2,
    REJECT: 1,
  };

  matches.sort((a, b) => {
    const pDiff =
      (priorityOrder[b.recommendation] ?? 0) -
      (priorityOrder[a.recommendation] ?? 0);
    if (pDiff !== 0) return pDiff;
    return b.confidenceScore - a.confidenceScore;
  });

  const bestMatch = matches[0];

  return {
    found: true,
    matches,
    match: bestMatch,
    pipelineStageSummary: `Decomposed into ${decomposition.subclaims.length} subclaim(s). Retrieved ${passages.length} passages, reranked top ${candidatesToVerify.length}. Best match: [${bestMatch.recommendation}] ${bestMatch.reference.title}.`,
  };
}
