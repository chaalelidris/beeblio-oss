import type { EvidenceVerificationLabel, CitationRecommendation } from "./types";

export type EvaluationItem = {
  id: string;
  category:
    | "directly_supported"
    | "partial_support"
    | "high_similarity_no_support"
    | "different_findings"
    | "numerical_mismatch"
    | "unit_mismatch"
    | "contradictory"
    | "causal_overreach"
    | "overgeneralized"
    | "neighboring_context_required"
    | "insufficient_evidence";
  claim: string;
  passage: string;
  neighboringContext?: string;
  expectedLabel: EvidenceVerificationLabel;
  expectedRecommendation: CitationRecommendation;
  notes: string;
};

/**
 * Standard benchmark dataset for evaluating citation verification pipelines.
 * Contains realistic scientific claim-passage pairs curated across disciplines
 * (genomics, clinical trials, deep learning, materials science, atmospheric physics).
 */
export const CITATION_EVALUATION_DATASET: EvaluationItem[] = [
  // 1. Directly Supported Claims
  {
    id: "eval-01-supported",
    category: "directly_supported",
    claim:
      "CRISPR-Cas9-mediated disruption of the BCL11A erythroid enhancer induced fetal hemoglobin production in human erythroid cells, with an editing efficiency of 85%.",
    passage:
      "Targeted editing of the BCL11A erythroid enhancer using Cas9 ribonucleoproteins produced robust reactivation of fetal hemoglobin (HbF) in erythroid precursors, achieving an indel rate of 85% at the core GATA1-binding locus.",
    expectedLabel: "SUPPORTED",
    expectedRecommendation: "RECOMMEND",
    notes: "Matches exact finding, editing efficiency (85%), and cellular model.",
  },
  {
    id: "eval-02-supported",
    category: "directly_supported",
    claim:
      "Transformer architectures trained with FlashAttention-2 demonstrated a 2.5x speedup compared to standard attention on A100 GPUs.",
    passage:
      "Benchmarking on NVIDIA A100 GPUs showed that FlashAttention-2 achieved a 2.5x throughput speedup over standard unfused multi-head self-attention implementations.",
    expectedLabel: "SUPPORTED",
    expectedRecommendation: "RECOMMEND",
    notes: "Exact matching 2.5x speedup metric and hardware conditions.",
  },

  // 2. High Semantic Similarity with NO Actual Support (Similarity Trap)
  {
    id: "eval-03-high-sim-trap",
    category: "high_similarity_no_support",
    claim:
      "Metformin treatment directly decreased tau phosphorylation in human Alzheimer's disease brain tissue.",
    passage:
      "Metformin is a widely prescribed biguanide for type 2 diabetes that regulates hepatic glucose production via AMPK activation. Recent epidemiology has linked diabetes to elevated risks of Alzheimer's disease and neurofibrillary tau tangles.",
    expectedLabel: "RELATED_BUT_UNSUPPORTED",
    expectedRecommendation: "REJECT",
    notes:
      "Shares keywords (metformin, Alzheimer's, tau tangles) but passage only discusses diabetes epidemiology and hepatic glucose, not tau phosphorylation in brain tissue.",
  },
  {
    id: "eval-04-high-sim-trap",
    category: "high_similarity_no_support",
    claim:
      "Lithium-sulfur batteries using solid-state polymer electrolytes achieved an energy density exceeding 500 Wh/kg at room temperature.",
    passage:
      "Lithium-sulfur batteries have attracted significant attention for electric vehicles owing to their high theoretical energy density of 2600 Wh/kg. Solid-state polymer electrolytes offer improved safety against polysulfide shuttle effects.",
    expectedLabel: "RELATED_BUT_UNSUPPORTED",
    expectedRecommendation: "REJECT",
    notes:
      "Contains theoretical metrics (2600 Wh/kg) and electrolyte discussion, but does not substantiate the empirical claim of achieving >500 Wh/kg at room temperature.",
  },

  // 3. Numerical & Unit Mismatches
  {
    id: "eval-05-num-mismatch",
    category: "numerical_mismatch",
    claim:
      "The phase III clinical trial reported an overall survival rate of 78% in the nivolumab arm at 24 months.",
    passage:
      "In the randomized phase III cohort, patients receiving nivolumab exhibited an overall survival rate of 58% at 24 months, compared to 39% in the chemotherapy arm.",
    expectedLabel: "CONTRADICTED",
    expectedRecommendation: "REJECT",
    notes: "Numerical mismatch: 78% claimed vs 58% actual reported in trial.",
  },
  {
    id: "eval-06-unit-mismatch",
    category: "unit_mismatch",
    claim:
      "The synthetic superconductor exhibited a critical transition temperature (Tc) of 145 K at ambient pressure.",
    passage:
      "Magnetic susceptibility measurements established superconducting transition onset with a Tc of 145 C under 150 GPa hydrostatic pressure.",
    expectedLabel: "CONTRADICTED",
    expectedRecommendation: "REJECT",
    notes: "Severe unit and condition mismatch: 145 K vs 145 C, and ambient vs 150 GPa.",
  },

  // 4. Contradictory Evidence
  {
    id: "eval-07-contradictory",
    category: "contradictory",
    claim:
      "Dietary supplementation with omega-3 fatty acids significantly reduced all-cause cardiovascular mortality in healthy adults.",
    passage:
      "A systematic meta-analysis of 86 randomized controlled trials revealed that omega-3 fatty acid intake had no statistically significant effect on all-cause mortality (RR 0.98, 95% CI 0.92-1.03) or cardiovascular events in the general population.",
    expectedLabel: "CONTRADICTED",
    expectedRecommendation: "REJECT",
    notes: "Direct empirical contradiction: claim asserts significant reduction, study found no effect.",
  },
  {
    id: "eval-08-contradictory",
    category: "contradictory",
    claim:
      "Fine-tuning large language models on synthetic instructions consistently degrades safety alignment scores.",
    passage:
      "Empirical evaluations demonstrated that synthetic instruction tuning substantially improved safety alignment, reducing harmful completion rates by 34% without degradation in general reasoning.",
    expectedLabel: "CONTRADICTED",
    expectedRecommendation: "REJECT",
    notes: "Directional contradiction: asserts degradation, evidence shows improvement.",
  },

  // 5. Causal Overreach (Correlation asserted as Causation)
  {
    id: "eval-09-causal-overreach",
    category: "causal_overreach",
    claim:
      "Increased screen time causes major depression and anxiety in adolescent populations.",
    passage:
      "Cross-sectional survey data from 40,000 adolescents indicated a positive statistical association between daily screen usage and depressive symptoms (r = 0.14, p < 0.01). However, causal directionality cannot be inferred due to potential reverse causality.",
    expectedLabel: "PARTIALLY_SUPPORTED",
    expectedRecommendation: "PARTIAL_SUPPORT",
    notes:
      "Author explicitly warns that findings are correlational and cross-sectional, not causal.",
  },

  // 6. Overgeneralized Claims
  {
    id: "eval-10-overgeneralized",
    category: "overgeneralized",
    claim:
      "The newly designed zinc-air battery operates flawlessly across all climate conditions and temperatures.",
    passage:
      "The optimized zinc-air cell demonstrated stable charge-discharge cycling over 200 hours in controlled laboratory ambient conditions (22°C to 25°C). Performance under sub-zero and high-humidity extremes was not investigated.",
    expectedLabel: "PARTIALLY_SUPPORTED",
    expectedRecommendation: "PARTIAL_SUPPORT",
    notes:
      "Claim uses absolute universal language ('flawlessly across all conditions') whereas evidence is restricted to room temperature laboratory settings.",
  },

  // 7. Partial Support (Multiple Subclaims, only some supported)
  {
    id: "eval-11-partial",
    category: "partial_support",
    claim:
      "The compound inhibited histone deacetylase 6 (HDAC6) with an IC50 of 4.2 nM and suppressed tumor growth in a murine xenograft model by 65%.",
    passage:
      "In vitro enzyme assays confirmed potent HDAC6 inhibition with an IC50 of 4.2 nM. In vivo pharmacological and pharmacokinetic analyses remain ongoing.",
    expectedLabel: "PARTIALLY_SUPPORTED",
    expectedRecommendation: "PARTIAL_SUPPORT",
    notes:
      "HDAC6 IC50 4.2 nM is supported, but in vivo murine xenograft suppression by 65% is absent.",
  },
  {
    id: "eval-12-partial",
    category: "partial_support",
    claim:
      "Graph neural networks outperformed convolutional baselines on protein solubility prediction and achieved 94% accuracy on ligand affinity classification.",
    passage:
      "Graph convolutional architectures outperformed 3D CNNs by 12% on the protein solubility benchmark. Ligand affinity experiments were beyond the scope of this study.",
    expectedLabel: "PARTIALLY_SUPPORTED",
    expectedRecommendation: "PARTIAL_SUPPORT",
    notes:
      "Supports protein solubility outperformance; ligand affinity classification was not tested.",
  },

  // 8. Neighboring Context Required
  {
    id: "eval-13-context-required",
    category: "neighboring_context_required",
    claim:
      "Atmospheric methane concentrations reached 1920 ppb in 2022, primarily driven by tropical wetland emissions.",
    passage:
      "Global atmospheric methane reached 1920 ppb in 2022, representing an annual increase of 14 ppb.",
    neighboringContext:
      "Global atmospheric methane reached 1920 ppb in 2022, representing an annual increase of 14 ppb. Isotopic 13C analysis indicates that microbial emissions from expanding tropical wetlands accounted for over 60% of this renewed growth.",
    expectedLabel: "SUPPORTED",
    expectedRecommendation: "RECOMMEND",
    notes:
      "Passage alone only supports 1920 ppb; neighboring context is required to verify the tropical wetland driver.",
  },

  // 9. Insufficient Evidence and Cases Requiring Abstention
  {
    id: "eval-14-insufficient",
    category: "insufficient_evidence",
    claim:
      "Quantum annealing on the D-Wave 2000Q processor provides exponential speedup over classical Markov Chain Monte Carlo for spin glass ground state estimation.",
    passage:
      "We investigate spin glass ground state estimation using quantum and classical heuristics. Several computational parameters were monitored across problem instances.",
    expectedLabel: "INSUFFICIENT_CONTEXT",
    expectedRecommendation: "NEEDS_REVIEW",
    notes:
      "Passage is merely introductory or abstract framing without reporting any quantitative speedup or conclusive empirical result.",
  },
  {
    id: "eval-15-insufficient",
    category: "insufficient_evidence",
    claim:
      "The newly discovered microRNA miR-342-5p regulates angiogenesis in ischemic stroke models by directly binding to the 3' UTR of VEGF.",
    passage:
      "Differential expression profiling of serum microRNAs in stroke patients identified significant deregulation of miR-342-5p alongside 14 other candidates.",
    expectedLabel: "INSUFFICIENT_CONTEXT",
    expectedRecommendation: "NEEDS_REVIEW",
    notes:
      "Confirms deregulation of miR-342-5p, but cannot verify binding to 3' UTR of VEGF or angiogenesis mechanism without functional assay data.",
  },
  {
    id: "eval-16-different-findings",
    category: "different_findings",
    claim:
      "Deep residual networks with 152 layers achieved a top-5 error rate of 3.57% on the ImageNet validation set.",
    passage:
      "On the ImageNet classification benchmark, our 152-layer deep residual network achieved a top-1 error of 19.38% and a top-5 error of 4.49% with single-crop testing.",
    expectedLabel: "CONTRADICTED",
    expectedRecommendation: "REJECT",
    notes: "Different metric: 4.49% single-crop reported in passage, not 3.57% (which was ensemble).",
  },
];
