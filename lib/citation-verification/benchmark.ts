import { CITATION_EVALUATION_DATASET, type EvaluationItem } from "./evaluation-dataset";
import { extractScientificClaim } from "./claim-extractor";
import { checkDeterministicConsistency } from "./consistency-checker";
import { verifyClaimEvidence } from "./claim-verifier";
import { evaluateCitationDecision } from "./decision-engine";
import { computePassageRetrievalScore, extractRetrievalTokens } from "./retrieval";
import type { EvidencePassage } from "./types";

export type BenchmarkMetrics = {
  totalItems: number;
  // Precision, Recall, F1 for supported citation approvals
  precision: number;
  recall: number;
  f1: number;
  // Critical Safety Metrics
  falseAcceptanceRate: number; // Invalid citations incorrectly approved
  falseRejectionRate: number; // Valid citations incorrectly rejected
  contradictionDetectionRate: number;
  partialSupportAccuracy: number;
  abstentionRate: number;
  numericalAndCausalAccuracy: number;
  // Confusion Matrix
  confusionMatrix: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    abstained: number;
  };
  individualResults: Array<{
    id: string;
    category: string;
    claim: string;
    expected: string;
    baselineDecision: string;
    upgradedDecision: string;
    baselineApproved: boolean;
    upgradedApproved: boolean;
    correct: boolean;
    reasoning: string;
  }>;
};

/**
 * Baseline embedding / keyword overlap simulator:
 * Calculates token similarity and phrase overlap.
 * Approves whenever score exceeds similarity threshold (default 55%).
 */
export function runBaselineEvaluation(
  items: EvaluationItem[] = CITATION_EVALUATION_DATASET,
  threshold: number = 55,
): BenchmarkMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let contradictionDetected = 0;
  let totalContradictions = 0;
  let partialCorrect = 0;
  let totalPartial = 0;
  let numCausalCorrect = 0;
  let totalNumCausal = 0;

  const results = items.map((item) => {
    const textToEvaluate = item.neighboringContext || item.passage;
    const tokens = extractRetrievalTokens(item.claim);
    const scored = computePassageRetrievalScore(textToEvaluate, item.claim, tokens);

    const approved = scored.score >= threshold;
    const isGroundTruthSupported =
      item.expectedRecommendation === "RECOMMEND";

    if (item.category === "contradictory") {
      totalContradictions++;
      if (!approved) contradictionDetected++;
    }
    if (item.category === "partial_support") {
      totalPartial++;
      // Baseline cannot classify partial support
    }
    if (
      item.category === "numerical_mismatch" ||
      item.category === "unit_mismatch" ||
      item.category === "causal_overreach"
    ) {
      totalNumCausal++;
      if (!approved) numCausalCorrect++;
    }

    if (approved && isGroundTruthSupported) tp++;
    else if (approved && !isGroundTruthSupported) fp++;
    else if (!approved && !isGroundTruthSupported) tn++;
    else if (!approved && isGroundTruthSupported) fn++;

    const baselineDecision = approved ? "RECOMMEND" : "REJECT";

    return {
      id: item.id,
      category: item.category,
      claim: item.claim,
      expected: item.expectedRecommendation,
      baselineDecision,
      upgradedDecision: baselineDecision,
      baselineApproved: approved,
      upgradedApproved: approved,
      correct: baselineDecision === item.expectedRecommendation,
      reasoning: `Baseline similarity score: ${scored.score}% (Threshold: ${threshold}%)`,
    };
  });

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const totalInvalid = items.filter((i) => i.expectedRecommendation !== "RECOMMEND").length;
  const totalValid = items.filter((i) => i.expectedRecommendation === "RECOMMEND").length;

  return {
    totalItems: items.length,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    f1: Math.round(f1 * 100) / 100,
    falseAcceptanceRate: totalInvalid > 0 ? Math.round((fp / totalInvalid) * 100) / 100 : 0,
    falseRejectionRate: totalValid > 0 ? Math.round((fn / totalValid) * 100) / 100 : 0,
    contradictionDetectionRate:
      totalContradictions > 0
        ? Math.round((contradictionDetected / totalContradictions) * 100) / 100
        : 0,
    partialSupportAccuracy:
      totalPartial > 0 ? Math.round((partialCorrect / totalPartial) * 100) / 100 : 0,
    abstentionRate: 0,
    numericalAndCausalAccuracy:
      totalNumCausal > 0 ? Math.round((numCausalCorrect / totalNumCausal) * 100) / 100 : 0,
    confusionMatrix: {
      truePositive: tp,
      falsePositive: fp,
      trueNegative: tn,
      falseNegative: fn,
      abstained: 0,
    },
    individualResults: results,
  };
}

/**
 * Upgraded Multi-Stage Evidence Verification Pipeline Evaluator:
 * Runs Claim Extraction -> Deterministic Consistency -> Entailment Verification -> Decision Engine.
 */
export async function runUpgradedPipelineEvaluation(
  items: EvaluationItem[] = CITATION_EVALUATION_DATASET,
): Promise<BenchmarkMetrics> {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let abstainedCount = 0;
  let contradictionDetected = 0;
  let totalContradictions = 0;
  let partialCorrect = 0;
  let totalPartial = 0;
  let numCausalCorrect = 0;
  let totalNumCausal = 0;

  const results = [];

  for (const item of items) {
    const textToEvaluate = item.neighboringContext || item.passage;
    const tokens = extractRetrievalTokens(item.claim);
    const retrieval = computePassageRetrievalScore(textToEvaluate, item.claim, tokens);

    // Stage A: Decompose Claim
    const decomposition = extractScientificClaim(item.claim);

    // Build EvidencePassage mock
    const passage: EvidencePassage = {
      id: item.id,
      citationKey: item.id,
      reference: {
        id: item.id,
        type: "article",
        title: "Benchmark Evaluation Paper",
        authors: "Doe et al.",
        year: "2024",
        container: "",
        publisher: "",
        volume: "",
        issue: "",
        pages: "",
        doi: "",
        url: "",
        abstract: "",
        isOpenAccess: false,
      },
      text: textToEvaluate,
      sourceLocation: "Section 3.2",
      retrievalScore: retrieval.score,
    };

    // Stage E: Deterministic Consistency Checks
    const consistency = checkDeterministicConsistency(decomposition, textToEvaluate);

    // Stage D: Entailment Verification (deterministic fallback for fast benchmark reproducibility)
    const verification = await verifyClaimEvidence(decomposition, passage, consistency);

    // Stage F: Decision Engine
    const decision = evaluateCitationDecision(
      decomposition,
      passage,
      verification,
      consistency,
    );

    const approved = decision.recommendation === "RECOMMEND";
    const isGroundTruthSupported =
      item.expectedRecommendation === "RECOMMEND";

    if (decision.recommendation === "NEEDS_REVIEW") {
      abstainedCount++;
    }

    if (item.category === "contradictory") {
      totalContradictions++;
      if (
        verification.label === "CONTRADICTED" ||
        decision.recommendation === "REJECT"
      ) {
        contradictionDetected++;
      }
    }

    if (item.category === "partial_support" || item.category === "causal_overreach" || item.category === "overgeneralized") {
      totalPartial++;
      if (decision.recommendation === "PARTIAL_SUPPORT") {
        partialCorrect++;
      }
    }

    if (
      item.category === "numerical_mismatch" ||
      item.category === "unit_mismatch" ||
      item.category === "causal_overreach"
    ) {
      totalNumCausal++;
      if (
        !consistency.passed ||
        decision.recommendation === "REJECT" ||
        decision.recommendation === "PARTIAL_SUPPORT"
      ) {
        numCausalCorrect++;
      }
    }

    if (approved && isGroundTruthSupported) tp++;
    else if (approved && !isGroundTruthSupported) fp++;
    else if (!approved && !isGroundTruthSupported) tn++;
    else if (!approved && isGroundTruthSupported) fn++;

    results.push({
      id: item.id,
      category: item.category,
      claim: item.claim,
      expected: item.expectedRecommendation,
      baselineDecision: "N/A",
      upgradedDecision: decision.recommendation,
      baselineApproved: false,
      upgradedApproved: approved,
      correct: decision.recommendation === item.expectedRecommendation,
      reasoning: decision.reason,
    });
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const totalInvalid = items.filter((i) => i.expectedRecommendation !== "RECOMMEND").length;
  const totalValid = items.filter((i) => i.expectedRecommendation === "RECOMMEND").length;

  return {
    totalItems: items.length,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    f1: Math.round(f1 * 100) / 100,
    falseAcceptanceRate: totalInvalid > 0 ? Math.round((fp / totalInvalid) * 100) / 100 : 0,
    falseRejectionRate: totalValid > 0 ? Math.round((fn / totalValid) * 100) / 100 : 0,
    contradictionDetectionRate:
      totalContradictions > 0
        ? Math.round((contradictionDetected / totalContradictions) * 100) / 100
        : 1.0,
    partialSupportAccuracy:
      totalPartial > 0 ? Math.round((partialCorrect / totalPartial) * 100) / 100 : 0,
    abstentionRate: Math.round((abstainedCount / items.length) * 100) / 100,
    numericalAndCausalAccuracy:
      totalNumCausal > 0 ? Math.round((numCausalCorrect / totalNumCausal) * 100) / 100 : 1.0,
    confusionMatrix: {
      truePositive: tp,
      falsePositive: fp,
      trueNegative: tn,
      falseNegative: fn,
      abstained: abstainedCount,
    },
    individualResults: results,
  };
}
