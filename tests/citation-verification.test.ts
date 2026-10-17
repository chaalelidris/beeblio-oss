import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractScientificClaim,
  checkDeterministicConsistency,
  verifyClaimEvidence,
  evaluateCitationDecision,
  buildVerifiedCitationMatch,
  rerankCandidates,
  type EvidencePassage,
} from "../lib/citation-verification/index.ts";
import {
  CITATION_EVALUATION_DATASET,
} from "../lib/citation-verification/evaluation-dataset.ts";
import {
  runBaselineEvaluation,
  runUpgradedPipelineEvaluation,
} from "../lib/citation-verification/benchmark.ts";

import type { CitationReference } from "../lib/citations.ts";

function mockRef(id: string, _key: string, title: string, authors: string, year: string): CitationReference {
  return {
    id,
    type: "article",
    title,
    authors,
    year,
    container: "",
    publisher: "",
    volume: "",
    issue: "",
    pages: "",
    doi: "",
    url: "",
    abstract: "",
    isOpenAccess: false,
  };
}

describe("Evidence-Based Citation Verification Pipeline", () => {
  // -------------------------------------------------------------
  // Stage A: Claim Extraction & Decomposition Tests
  // -------------------------------------------------------------
  describe("Stage A: Scientific Claim Extraction", () => {
    test("Extracts numerical values, percentages, and units correctly", () => {
      const claimText =
        "CRISPR editing of the BCL11A enhancer induced fetal hemoglobin production with an efficiency of 85% at a temperature of 37 C.";
      const decomp = extractScientificClaim(claimText);

      assert.equal(decomp.originalClaim, claimText);
      assert.ok(decomp.numericalValues.some((v) => v.value === 85 && v.unit === "%"));
      assert.ok(decomp.numericalValues.some((v) => v.value === 37 && v.unit === "C"));
    });

    test("Detects causal markers and categorizes claim accurately", () => {
      const causalClaim =
        "Increased screen time causes depression and anxiety in adolescents.";
      const decomp = extractScientificClaim(causalClaim);

      assert.equal(decomp.hasCausalClaim, true);
      assert.ok(decomp.causalMarkers.includes("causes"));
      assert.equal(decomp.claimCategory, "causal_explanation");
    });

    test("Decomposes compound sentences into verifiable subclaims", () => {
      const compound =
        "The compound inhibited HDAC6 with an IC50 of 4.2 nM and suppressed tumor growth in a murine xenograft model by 65%.";
      const decomp = extractScientificClaim(compound);

      assert.ok(decomp.subclaims.length >= 2, "Should decompose compound claim into at least 2 subclaims");
      assert.ok(decomp.subclaims.some((s) => s.includes("HDAC6")));
      assert.ok(decomp.subclaims.some((s) => s.includes("tumor growth") || s.includes("xenograft")));
    });
  });

  // -------------------------------------------------------------
  // Stage E: Deterministic Consistency Checks
  // -------------------------------------------------------------
  describe("Stage E: Deterministic Consistency Checks", () => {
    test("Flags numerical mismatch when numbers conflict", () => {
      const decomp = extractScientificClaim(
        "Overall survival reached 78% in the patient cohort.",
      );
      const passage = "In the patient cohort, overall survival reached 58% at 24 months.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.numericalMatch, false);
      assert.ok(check.discrepancies.some((d) => d.includes("78") && d.includes("58")));
    });

    test("Flags unit mismatch between Celsius and Kelvin", () => {
      const decomp = extractScientificClaim(
        "The superconductor reached critical transition at 145 K.",
      );
      const passage = "Transition was recorded at 145 C under high pressure.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.unitMatch, false);
      assert.ok(check.discrepancies.some((d) => d.includes("Unit mismatch")));
    });

    test("Flags causal overreach when source reports correlation or association", () => {
      const decomp = extractScientificClaim(
        "Increased screen time causes severe clinical depression in adolescents.",
      );
      const passage =
        "Survey data revealed a positive statistical association between screen time and depressive symptoms, but causality cannot be established.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.causalityMatch, false);
      assert.ok(check.discrepancies.some((d) => d.includes("Causal overreach")));
    });

    test("Flags directional polarity contradiction", () => {
      const decomp = extractScientificClaim(
        "Dietary omega-3 fatty acids significantly reduced cardiovascular mortality.",
      );
      const passage =
        "Meta-analysis showed that omega-3 intake had no statistically significant effect on mortality.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.polarityMatch, false);
    });

    test("Flags overestimation vs underestimation conflict", () => {
      const decomp = extractScientificClaim(
        "Standard CMIP5 models consistently overestimate canopy surface resistance.",
      );
      const passage =
        "FluxNet observations established that standard CMIP5 simulations underestimate canopy resistance by 35%.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.polarityMatch, false);
      assert.ok(
        check.discrepancies.some((d) =>
          d.includes("overestimation vs underestimation"),
        ),
      );
    });

    test("Flags acceleration vs deceleration conflict", () => {
      const decomp = extractScientificClaim(
        "Recent warming accelerated hydrological cycling in the Mediterranean.",
      );
      const passage =
        "Reconstructed precipitation series indicated that warming decelerated hydrological turnover across the Mediterranean.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.equal(check.polarityMatch, false);
      assert.ok(check.discrepancies.some((d) => d.includes("Directional conflict")));
    });

    test("Flags experimental model mismatch when human claim is grounded solely in pre-clinical mouse data", () => {
      const decomp = extractScientificClaim(
        "The targeted antibody suppressed metastasis in human patients with triple-negative breast cancer.",
      );
      const passage =
        "Administration of the monoclonal antibody in C57BL/6 mice bearing murine mammary carcinoma significantly suppressed lung metastasis.";
      const check = checkDeterministicConsistency(decomp, passage);

      assert.equal(check.passed, false);
      assert.ok(
        check.warnings.some((w) =>
          w.includes("Model boundary alert") || w.includes("murine"),
        ),
      );
    });
  });

  // -------------------------------------------------------------
  // Stage D: Claim–Evidence Entailment Verification
  // -------------------------------------------------------------
  describe("Stage D: Claim-Evidence Verification", () => {
    test("Classifies directly supported evidence as SUPPORTED", async () => {
      const decomp = extractScientificClaim(
        "Benchmarking FlashAttention-2 demonstrated a 2.5x speedup over standard attention.",
      );
      const passage: EvidencePassage = {
        id: "p1",
        citationKey: "dao2023",
        reference: mockRef("1", "dao2023", "FlashAttention-2", "Dao", "2023"),
        text: "FlashAttention-2 achieved a 2.5x throughput speedup over standard unfused multi-head self-attention.",
        sourceLocation: "Section 4.1",
        retrievalScore: 85,
      };
      const consistency = checkDeterministicConsistency(decomp, passage.text);
      const result = await verifyClaimEvidence(decomp, passage, consistency);

      assert.equal(result.label, "SUPPORTED");
      assert.ok(result.supportedSubclaims.length > 0);
    });

    test("Classifies contradiction as CONTRADICTED", async () => {
      const decomp = extractScientificClaim(
        "Synthetic instruction tuning consistently degrades model safety.",
      );
      const passage: EvidencePassage = {
        id: "p2",
        citationKey: "smith2024",
        reference: mockRef("2", "smith2024", "Synthetic Safety", "Smith", "2024"),
        text: "Empirical evaluations showed synthetic instruction tuning substantially improved safety alignment by 34%.",
        sourceLocation: "Page 6",
        retrievalScore: 75,
      };
      const consistency = checkDeterministicConsistency(decomp, passage.text);
      const result = await verifyClaimEvidence(decomp, passage, consistency);

      assert.equal(result.label, "CONTRADICTED");
    });

    test("Abstains and returns INSUFFICIENT_CONTEXT on ambiguous framing", async () => {
      const decomp = extractScientificClaim(
        "Quantum annealing provides exponential speedup over classical Markov Chain Monte Carlo.",
      );
      const passage: EvidencePassage = {
        id: "p3",
        citationKey: "quantum2021",
        reference: mockRef("3", "quantum2021", "Quantum Heuristics", "Doe", "2021"),
        text: "We investigate spin glass ground state estimation using quantum and classical heuristics.",
        sourceLocation: "Abstract",
        retrievalScore: 60,
      };
      const consistency = checkDeterministicConsistency(decomp, passage.text);
      const result = await verifyClaimEvidence(decomp, passage, consistency);

      assert.equal(result.label, "INSUFFICIENT_CONTEXT");
      assert.equal(result.abstained, true);
    });
  });

  // -------------------------------------------------------------
  // Stage F: Citation Decision Engine Tests
  // -------------------------------------------------------------
  describe("Stage F: Citation Decision Engine", () => {
    test("CRITICAL: High retrieval similarity with insufficient evidence NEVER produces RECOMMEND", () => {
      const decomp = extractScientificClaim(
        "Metformin treatment directly decreased tau phosphorylation in Alzheimer's brain tissue.",
      );
      const highSimilarityPassage: EvidencePassage = {
        id: "p4",
        citationKey: "metformin2020",
        reference: mockRef("4", "metformin2020", "Metformin in Diabetes", "Jones", "2020"),
        text: "Metformin regulates glucose production. Diabetes epidemiology shows links to Alzheimer's disease and tau tangles.",
        sourceLocation: "Introduction",
        retrievalScore: 92, // VERY HIGH similarity, but zero evidence for the claim!
      };

      const consistency = checkDeterministicConsistency(decomp, highSimilarityPassage.text);
      const verification = {
        label: "RELATED_BUT_UNSUPPORTED" as const,
        supportedSubclaims: [],
        unsupportedSubclaims: [decomp.mainClaim],
        contradictedSubclaims: [],
        exactQuote: highSimilarityPassage.text,
        reasoning: "Passage discusses epidemiology, not direct decrease in tau phosphorylation.",
        confidence: "high" as const,
        confidenceScore: 85,
        abstained: false,
      };

      const decision = evaluateCitationDecision(
        decomp,
        highSimilarityPassage,
        verification,
        consistency,
      );

      assert.equal(decision.recommendation, "REJECT", "Must strictly REJECT high similarity topic trap");
      assert.notEqual(decision.recommendation, "RECOMMEND");
    });

    test("Builds backward-compatible VerifiedCitationMatch object", () => {
      const decomp = extractScientificClaim("FlashAttention-2 provides 2.5x speedup.");
      const passage: EvidencePassage = {
        id: "p5",
        citationKey: "dao2023",
        reference: mockRef("5", "dao2023", "FlashAttention-2", "Dao", "2023"),
        text: "FlashAttention-2 achieved a 2.5x speedup.",
        sourceLocation: "Abstract",
        retrievalScore: 95,
      };
      const consistency = checkDeterministicConsistency(decomp, passage.text);
      const verification = {
        label: "SUPPORTED" as const,
        supportedSubclaims: ["FlashAttention-2 provides 2.5x speedup."],
        unsupportedSubclaims: [],
        contradictedSubclaims: [],
        exactQuote: passage.text,
        reasoning: "Exact match verified.",
        confidence: "high" as const,
        confidenceScore: 95,
        abstained: false,
      };

      const match = buildVerifiedCitationMatch(decomp, passage, verification, consistency);

      assert.equal(match.recommendation, "RECOMMEND");
      assert.equal(match.citationKey, "dao2023");
      // Backward compatibility fields
      assert.equal(typeof match.score, "number");
      assert.equal(typeof match.originalText, "string");
      assert.equal(typeof match.explanation, "string");
    });
  });

  // -------------------------------------------------------------
  // Stage C: Reranker Alignment Tests
  // -------------------------------------------------------------
  describe("Stage C: Alignment Reranker", () => {
    test("Reranks candidate with matching entities and numerical anchors higher", () => {
      const decomp = extractScientificClaim(
        "FlashAttention-2 achieved a 2.5x speedup on A100 GPUs.",
      );
      const passages: EvidencePassage[] = [
        {
          id: "p_weak",
          citationKey: "attn2017",
          reference: mockRef("w", "attn2017", "Standard Attention", "Vaswani", "2017"),
          text: "Attention mechanisms are widely used in sequence modeling across neural networks.",
          sourceLocation: "Intro",
          retrievalScore: 70,
        },
        {
          id: "p_strong",
          citationKey: "dao2023",
          reference: mockRef("s", "dao2023", "FlashAttention-2", "Dao", "2023"),
          text: "FlashAttention-2 achieved 2.5x speedup on NVIDIA A100 GPUs.",
          sourceLocation: "Results",
          retrievalScore: 75,
        },
      ];

      const reranked = rerankCandidates(decomp, passages);
      assert.equal(reranked[0].citationKey, "dao2023", "Strong entity and numerical anchor must rank top");
      assert.ok((reranked[0].rerankScore ?? 0) > (reranked[1].rerankScore ?? 0));
    });
  });

  // -------------------------------------------------------------
  // Benchmark & Evaluation Dataset Tests
  // -------------------------------------------------------------
  describe("Citation Evaluation Benchmark", () => {
    test("Evaluation dataset contains comprehensive realistic scientific claims", () => {
      assert.ok(CITATION_EVALUATION_DATASET.length >= 15);
      const categories = new Set(CITATION_EVALUATION_DATASET.map((i) => i.category));
      assert.ok(categories.has("directly_supported"));
      assert.ok(categories.has("high_similarity_no_support"));
      assert.ok(categories.has("numerical_mismatch"));
      assert.ok(categories.has("contradictory"));
      assert.ok(categories.has("causal_overreach"));
      assert.ok(categories.has("insufficient_evidence"));
    });

    test("Upgraded Pipeline outperforms Baseline by eliminating False Approvals (FAR = 0%)", async () => {
      const baseline = runBaselineEvaluation(CITATION_EVALUATION_DATASET, 55);
      const upgraded = await runUpgradedPipelineEvaluation(CITATION_EVALUATION_DATASET);

      // Baseline has high false acceptance rate due to semantic similarity traps
      assert.ok(
        baseline.falseAcceptanceRate >= 0.35,
        `Baseline FAR should be high due to keyword/similarity overlap (actual: ${baseline.falseAcceptanceRate})`,
      );

      // Upgraded system must achieve 0% False Acceptance Rate on the test dataset!
      assert.equal(
        upgraded.falseAcceptanceRate,
        0,
        `Upgraded system must NEVER approve false citations (actual FAR: ${upgraded.falseAcceptanceRate})`,
      );

      // Upgraded precision must be 1.0 (100%)
      assert.equal(upgraded.precision, 1.0);

      // Upgraded contradiction detection rate must be 100%
      assert.equal(upgraded.contradictionDetectionRate, 1.0);

      // Upgraded numerical and causal accuracy must be 100%
      assert.equal(upgraded.numericalAndCausalAccuracy, 1.0);
    });
  });
});
