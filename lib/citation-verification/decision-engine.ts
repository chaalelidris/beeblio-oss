import type {
  CitationRecommendation,
  ClaimDecomposition,
  ConsistencyReport,
  EvidencePassage,
  VerificationResult,
  VerifiedCitationMatch,
} from "./types";

export type DecisionOutput = {
  recommendation: CitationRecommendation;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  reason: string;
  displayScore: number;
};

/**
 * Stage F: Citation Decision Engine
 * Synthesizes claim decomposition, retrieval provenance, verification classification,
 * and deterministic consistency validation into an explainable recommendation.
 *
 * CRITICAL RULE: High embedding or retrieval similarity NEVER approves a citation alone.
 */
export function evaluateCitationDecision(
  _claim: ClaimDecomposition,
  passage: EvidencePassage,
  verification: VerificationResult,
  consistency: ConsistencyReport,
): DecisionOutput {
  // 1. Abstention or Insufficient Context -> NEVER APPROVE
  if (
    verification.abstained ||
    verification.label === "INSUFFICIENT_CONTEXT"
  ) {
    return {
      recommendation: "NEEDS_REVIEW",
      confidence: "low",
      confidenceScore: 30,
      reason:
        verification.abstentionReason ||
        "The passage provides insufficient context to verify the claim with certainty. Review source directly.",
      displayScore: Math.min(50, passage.retrievalScore),
    };
  }

  // 2. Contradiction Detected -> Strictly REJECT
  if (
    verification.label === "CONTRADICTED" ||
    verification.contradictedSubclaims.length > 0 ||
    !consistency.polarityMatch
  ) {
    const contradictReason =
      verification.contradictedSubclaims.length > 0
        ? `Evidence directly contradicts subclaim: "${verification.contradictedSubclaims[0]}".`
        : "Evidence contradicts the findings or directional assertions in the claim.";
    return {
      recommendation: "REJECT",
      confidence: "high",
      confidenceScore: 90,
      reason: contradictReason,
      displayScore: 10,
    };
  }

  // 3. Critical consistency failure (e.g. numerical mismatch or severe causal overreach)
  if (!consistency.passed && consistency.discrepancies.length > 0) {
    // If numbers conflict, it cannot be safely recommended
    if (!consistency.numericalMatch || !consistency.unitMatch) {
      return {
        recommendation: "REJECT",
        confidence: "high",
        confidenceScore: 85,
        reason: `Numerical or unit discrepancy: ${consistency.discrepancies.join("; ")}.`,
        displayScore: 25,
      };
    }

    // Causal overreach or absolute claims -> PARTIAL_SUPPORT or NEEDS_REVIEW
    if (!consistency.causalityMatch) {
      return {
        recommendation: "PARTIAL_SUPPORT",
        confidence: "medium",
        confidenceScore: 60,
        reason: `Causal inference mismatch: ${consistency.discrepancies.join("; ")}. Tone down causal assertion or review study methodology.`,
        displayScore: 55,
      };
    }
  }

  // 4. Topic related but unsupported findings -> REJECT
  if (verification.label === "RELATED_BUT_UNSUPPORTED") {
    return {
      recommendation: "REJECT",
      confidence: "high",
      confidenceScore: 80,
      reason:
        verification.reasoning ||
        "Passage discusses related topics or terminology but does not substantiate the specific scientific finding.",
      displayScore: Math.min(45, passage.retrievalScore),
    };
  }

  // 5. Partially supported claims -> PARTIAL_SUPPORT
  if (
    verification.label === "PARTIALLY_SUPPORTED" ||
    (verification.supportedSubclaims.length > 0 &&
      verification.unsupportedSubclaims.length > 0)
  ) {
    const supportedList = verification.supportedSubclaims.slice(0, 2).join("; ");
    const unsupportedList = verification.unsupportedSubclaims.slice(0, 2).join("; ");
    return {
      recommendation: "PARTIAL_SUPPORT",
      confidence: "medium",
      confidenceScore: 70,
      reason: `Supports: [${supportedList}]. Still requires evidence for: [${unsupportedList}].`,
      displayScore: 72,
    };
  }

  // 6. Direct SUPPORTED with verified consistency
  if (verification.label === "SUPPORTED" && consistency.passed) {
    // Check if any warnings exist (e.g. conditional boundary or minor causal marker)
    if (consistency.warnings.length > 0) {
      return {
        recommendation: "RECOMMEND",
        confidence: "medium",
        confidenceScore: 85,
        reason: `${verification.reasoning || "Directly supports claim."} Note: ${consistency.warnings.join("; ")}`,
        displayScore: 92,
      };
    }

    return {
      recommendation: "RECOMMEND",
      confidence: "high",
      confidenceScore: 95,
      reason:
        verification.reasoning ||
        "Direct evidentiary support verified with matching entities and metrics.",
      displayScore: 96,
    };
  }

  // Default fallback for any boundary condition: NEEDS_REVIEW
  return {
    recommendation: "NEEDS_REVIEW",
    confidence: "medium",
    confidenceScore: 50,
    reason:
      verification.reasoning ||
      "Verification could not conclusively approve or reject. Human peer review recommended.",
    displayScore: 50,
  };
}

/**
 * Builds the fully qualified, backward-compatible VerifiedCitationMatch object.
 */
export function buildVerifiedCitationMatch(
  claim: ClaimDecomposition,
  passage: EvidencePassage,
  verification: VerificationResult,
  consistency: ConsistencyReport,
): VerifiedCitationMatch {
  const decision = evaluateCitationDecision(
    claim,
    passage,
    verification,
    consistency,
  );

  const quote = verification.exactQuote || passage.text;

  return {
    citationKey: passage.citationKey,
    reference: passage.reference,
    originalClaim: claim.originalClaim,
    evidenceExcerpt: quote,
    sourceLocation: passage.sourceLocation,
    sourceFilePath: passage.sourceFilePath,
    sourceFileName: passage.sourceFileName,
    retrievalScore: passage.retrievalScore,
    rerankScore: passage.rerankScore,
    verificationLabel: verification.label,
    supportedSubclaims: verification.supportedSubclaims,
    unsupportedSubclaims: verification.unsupportedSubclaims,
    contradictedSubclaims: verification.contradictedSubclaims,
    discrepancies: [
      ...consistency.discrepancies,
      ...consistency.warnings,
      ...(passage.isSecondaryCitation
        ? [`Secondary citation: Passage references external work (${passage.secondaryCitationRef || "prior literature"}). Confirm original source.`]
        : []),
    ],
    reasoning: decision.reason,
    recommendation: decision.recommendation,
    confidence: decision.confidence,
    confidenceScore: decision.confidenceScore,
    abstained: verification.abstained,
    abstentionReason: verification.abstentionReason,
    isSecondaryCitation: passage.isSecondaryCitation,
    secondaryCitationRef: passage.secondaryCitationRef,

    // Legacy CitationFindMatch properties for backward compatibility
    originalText: quote,
    explanation: decision.reason,
    score: decision.displayScore,
  };
}
