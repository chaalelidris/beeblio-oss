import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { getAiTaskConfig } from "../local-ai-settings";
import type {
  ClaimDecomposition,
  EvidencePassage,
  VerificationResult,
  EvidenceVerificationLabel,
  ConsistencyReport,
  ClaimVerdict,
} from "./types";
import { verifyConsistency, SCIENTIFIC_SYNONYM_MAP } from "./consistency-checker";
import {
  searchSourceForEvidence,
  getCachedPdfDocument,
  type SourceSearchTarget,
} from "./retrieval";

/**
 * Deterministic semantic and lexical verification fallback.
 * Evaluates subclaim coverage, entity matching, and consistency checks
 * without requiring external model APIs.
 *
 * CRITICAL RULE: Never treats a single retrieved excerpt as complete evidence.
 * When initial evidence is insufficient, searches the full accessible source
 * (neighboring context, other sentences, other pages/sections) before assigning
 * a final verdict, distinguishing UNSUPPORTED from UNVERIFIABLE and INCOMPLETE_RETRIEVAL.
 */
export function verifyClaimDeterministically(
  claim: ClaimDecomposition,
  passage: EvidencePassage,
): VerificationResult {
  const consistency = verifyConsistency(claim, passage.text);
  const passageLower = passage.text.toLowerCase();

  // Normalize scientific formulas, LaTeX, and notations in passage for fair matching
  const normalizedPassage = passageLower
    .replace(/\$r_\{?s\}?\$|\br_s\b|\brs\b/g, " surface resistance rs ")
    .replace(/\$sm\^?\{?-?1\}?\$|s\s*m\s*[−-]\s*1|\bsm-1\b|\bs\/m\b/g, " seconds per meter s/m ")
    .replace(/\$pet\$|\bpet\b/g, " potential evapotranspiration pet ")
    .replace(/\$vpd\$|\bvpd\b/g, " vapor pressure deficit vpd ")
    .replace(/[$_{}]/g, " ")
    .replace(/\s+/g, " ");

  // 1. Check for hard explicit contradictions or conflicting numerical values
  const hasHardContradiction =
    !consistency.polarityMatch ||
    !consistency.unitMatch ||
    consistency.discrepancies.some((d) =>
      d.includes("Contradiction") ||
      d.includes("Directional conflict") ||
      d.includes("Numerical mismatch") ||
      d.includes("Unit discrepancy") ||
      d.includes("Unit mismatch")
    );

  if (hasHardContradiction) {
    return {
      label: "CONTRADICTED",
      supportedSubclaims: [],
      unsupportedSubclaims: [],
      contradictedSubclaims: claim.subclaims,
      exactQuote: passage.text.slice(0, 200),
      reasoning: consistency.discrepancies.join(" "),
      confidence: "high",
      confidenceScore: 90,
      abstained: false,
      pageNumber: passage.pageNumber,
      sourceLocation: passage.sourceLocation,
      neighboringContext: passage.neighboringContext,
      claimVerdicts: claim.subclaims.map((sub) => ({
        claimText: sub,
        label: "CONTRADICTED" as const,
        supported: false,
        exactQuote: passage.text.slice(0, 200),
        pageNumber: passage.pageNumber,
        sourceLocation: passage.sourceLocation,
        reasoning: consistency.discrepancies.join(" "),
      })),
    };
  }

  // 2. Check subclaim support on immediate passage text
  const supportedSubclaims: string[] = [];
  const unsupportedSubclaims: string[] = [];

  for (const sub of claim.subclaims) {
    const subWords = sub
      .toLowerCase()
      .match(/\b[a-z]{3,}\b/g)
      ?.filter((w) => !["the", "and", "for", "with", "that", "this"].includes(w)) || [];

    if (subWords.length === 0) continue;

    let matchedCount = 0;
    for (const word of subWords) {
      if (normalizedPassage.includes(word) || passageLower.includes(word)) {
        matchedCount++;
        continue;
      }
      let synonymMatched = false;
      for (const [key, synonyms] of Object.entries(SCIENTIFIC_SYNONYM_MAP)) {
        if (key.includes(word) || synonyms.includes(word)) {
          if (synonyms.some((syn) => normalizedPassage.includes(syn) || passageLower.includes(syn))) {
            synonymMatched = true;
            break;
          }
        }
      }
      if (synonymMatched) {
        matchedCount++;
      }
    }

    const coverage = matchedCount / subWords.length;
    if (coverage >= 0.50 && consistency.numericalMatch) {
      supportedSubclaims.push(sub);
    } else {
      unsupportedSubclaims.push(sub);
    }
  }

  // Check entity alignment
  const matchedEntities = claim.entities.filter(
    (e) => normalizedPassage.includes(e.toLowerCase()) || passageLower.includes(e.toLowerCase()),
  );
  const entityCoverage = claim.entities.length > 0 ? matchedEntities.length / claim.entities.length : 1;

  // Extract initial best quote
  const sentences = passage.text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 20);
  let bestQuote = passage.text.slice(0, 220);
  let maxScore = -1;
  const claimWords = new Set(claim.originalClaim.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
  for (const s of sentences) {
    const sWords = s.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const count = sWords.filter((w) => claimWords.has(w)).length;
    if (count > maxScore) {
      maxScore = count;
      bestQuote = s.trim();
    }
  }

  let activeContext = passage.neighboringContext;
  let activePageNumber = passage.pageNumber;
  let activeLocation = passage.sourceLocation;

  // Source accessibility tracking
  const hasAccessibleSource =
    passage.fullSourceAvailable === true ||
    (passage.fullSourcePages !== undefined && passage.fullSourcePages.length > 0) ||
    (passage.fullSourceText !== undefined && passage.fullSourceText.length > 0) ||
    (passage.sourceFilePath !== undefined && getCachedPdfDocument(passage.sourceFilePath) !== undefined);

  let sourceSearched = false;
  let resolvedBySearch = false;

  const sourceTarget: SourceSearchTarget = {
    citationKey: passage.citationKey,
    reference: passage.reference,
    pages: passage.fullSourcePages ?? (passage.sourceFilePath ? getCachedPdfDocument(passage.sourceFilePath)?.pages : undefined),
    fullText: passage.fullSourceText,
    neighboringContext: passage.neighboringContext,
    sourceFilePath: passage.sourceFilePath,
  };

  // 3. INCOMPLETE RETRIEVAL EXPANSION:
  // If the initial excerpt does not fully support all subclaims or metrics,
  // NEVER assume lack of support without checking neighboring context and full source.
  if (supportedSubclaims.length < claim.subclaims.length || !consistency.passed) {
    // 3a. Check neighboring context first
    if (passage.neighboringContext && passage.neighboringContext.length > passage.text.length) {
      const contextCheck = searchSourceForEvidence(
        { neighboringContext: passage.neighboringContext },
        claim,
      );
      if (contextCheck && contextCheck.found) {
        resolvedBySearch = true;
        activeContext = contextCheck.neighboringContext;
        bestQuote = contextCheck.exactQuote;
      }
    }

    // 3b. Search full accessible source (all pages, sections, paragraphs)
    if (!resolvedBySearch && hasAccessibleSource) {
      sourceSearched = true;
      const fullSearchResult = searchSourceForEvidence(sourceTarget, claim);
      if (fullSearchResult && fullSearchResult.found) {
        resolvedBySearch = true;
        activeContext = fullSearchResult.neighboringContext;
        activePageNumber = fullSearchResult.pageNumber ?? passage.pageNumber;
        activeLocation =
          fullSearchResult.sourceLocation ||
          (fullSearchResult.pageNumber ? `Page ${fullSearchResult.pageNumber}` : passage.sourceLocation);
        bestQuote = fullSearchResult.exactQuote;
      }
    }
  }

  // 4. Determine final label and claim-level verdicts
  let label: EvidenceVerificationLabel;
  let confidence: "high" | "medium" | "low" = "medium";
  let confidenceScore = 60;
  let reasoning = "";
  let abstained = false;
  let abstentionReason: string | undefined;

  // Check introductory framing check
  const isIntroductoryFraming =
    /\b(we investigate|we study|we consider|we examine|we monitor|several parameters were monitored|preliminary parameters|investigate the feasibility)\b/i.test(passageLower) &&
    !/\b(achieved|demonstrated|resulted in|found that|showed that|exhibited|improved by|reduced by|confirmed|measured|increases|anomalies)\b/i.test(passageLower);

  if (resolvedBySearch) {
    label = "SUPPORTED";
    confidence = "high";
    confidenceScore = 92;
    reasoning = `Direct evidentiary support confirmed across all subclaims after retrieving full source context (${activeLocation}): "${bestQuote}".`;
    supportedSubclaims.splice(0, supportedSubclaims.length, ...claim.subclaims);
    unsupportedSubclaims.splice(0, unsupportedSubclaims.length);
  } else if (supportedSubclaims.length === claim.subclaims.length && consistency.passed && entityCoverage >= 0.5) {
    label = "SUPPORTED";
    confidence = consistency.warnings.length === 0 ? "high" : "medium";
    confidenceScore = consistency.warnings.length === 0 ? 88 : 74;
    reasoning = `Direct evidentiary support confirmed across all subclaims in ${passage.reference.title || "source"}.`;
  } else if (supportedSubclaims.length > 0) {
    label = "PARTIALLY_SUPPORTED";
    confidenceScore = 65;
    reasoning = `Supports ${supportedSubclaims.length} of ${claim.subclaims.length} subclaims, but requires additional evidence for unverified assertions (${unsupportedSubclaims.join("; ")}).`;
  } else if (passage.text.trim().length < 40 || isIntroductoryFraming) {
    label = "INSUFFICIENT_CONTEXT";
    confidence = "low";
    confidenceScore = 30;
    abstained = true;
    abstentionReason = "Context lacks reported empirical findings or outcome metrics.";
    reasoning = "Passage contains introductory or scoping framing without reporting empirical results or findings.";
  } else if (sourceSearched) {
    // The full accessible source was searched across all accessible pages/sections, and truly lacks evidence
    label = "UNSUPPORTED";
    confidence = "high";
    confidenceScore = 80;
    reasoning = `Full accessible source document was searched across all pages and sections, but contains no evidence supporting this claim.`;
  } else if (!hasAccessibleSource) {
    // Initial retrieval returned an incomplete excerpt, and full document was not accessible
    label = "INCOMPLETE_RETRIEVAL";
    confidence = "low";
    confidenceScore = 35;
    abstained = true;
    abstentionReason = "Initial retrieval returned insufficient evidence and full source document was not accessible to complete verification.";
    reasoning = "Evidence was insufficient in the retrieved excerpt, and the full source document was not accessible to complete verification.";
  } else {
    label = "RELATED_BUT_UNSUPPORTED";
    confidenceScore = 40;
    reasoning = consistency.discrepancies.length > 0
      ? `Topic is relevant but factual details differ: ${consistency.discrepancies.join("; ")}`
      : "The passage discusses related scientific topics or concepts but does not establish or report the author's specific empirical finding.";
  }

  // 5. Generate granular claim-level verdicts with exact quotes and page numbers
  const claimVerdicts: ClaimVerdict[] = [];
  const supportingPassages: Array<{ quote: string; pageNumber?: number; sourceLocation?: string }> = [];

  for (const sub of claim.subclaims) {
    const isDirectlySupported = resolvedBySearch || supportedSubclaims.includes(sub);
    if (isDirectlySupported) {
      claimVerdicts.push({
        claimText: sub,
        label: "SUPPORTED",
        supported: true,
        exactQuote: bestQuote,
        pageNumber: activePageNumber,
        sourceLocation: activeLocation,
        neighboringContext: activeContext,
        reasoning: `Supported by source evidence in ${activeLocation}.`,
      });
      supportingPassages.push({
        quote: bestQuote,
        pageNumber: activePageNumber,
        sourceLocation: activeLocation,
      });
    } else if (hasAccessibleSource) {
      // Search full source specifically for this individual subclaim
      const subSearch = searchSourceForEvidence(sourceTarget, sub);
      if (subSearch && subSearch.found) {
        claimVerdicts.push({
          claimText: sub,
          label: "SUPPORTED",
          supported: true,
          exactQuote: subSearch.exactQuote,
          pageNumber: subSearch.pageNumber ?? activePageNumber,
          sourceLocation: subSearch.sourceLocation,
          neighboringContext: subSearch.neighboringContext,
          reasoning: `Found in source document (${subSearch.sourceLocation}): "${subSearch.exactQuote}".`,
        });
        supportingPassages.push({
          quote: subSearch.exactQuote,
          pageNumber: subSearch.pageNumber ?? activePageNumber,
          sourceLocation: subSearch.sourceLocation,
        });
      } else {
        claimVerdicts.push({
          claimText: sub,
          label: "UNSUPPORTED",
          supported: false,
          pageNumber: activePageNumber,
          sourceLocation: activeLocation,
          reasoning: "Not found after searching full accessible source document.",
        });
      }
    } else {
      claimVerdicts.push({
        claimText: sub,
        label: "INCOMPLETE_RETRIEVAL",
        supported: false,
        reasoning: "Incomplete retrieval; full source document was not accessible.",
      });
    }
  }

  // If all individual subclaims are verified via search, elevate overall label
  if (claimVerdicts.length > 0 && claimVerdicts.every((v) => v.supported)) {
    label = "SUPPORTED";
    confidence = "high";
    confidenceScore = 92;
    reasoning = `All claims verified against source (${activeLocation}). Supporting evidence: "${claimVerdicts.map((v) => v.exactQuote).filter(Boolean).join(" ")}".`;
    supportedSubclaims.splice(0, supportedSubclaims.length, ...claim.subclaims);
    unsupportedSubclaims.splice(0, unsupportedSubclaims.length);
    abstained = false;
    abstentionReason = undefined;
  }

  return {
    label,
    supportedSubclaims,
    unsupportedSubclaims,
    contradictedSubclaims: [],
    exactQuote: bestQuote,
    reasoning,
    confidence,
    confidenceScore,
    abstained,
    abstentionReason,
    pageNumber: activePageNumber,
    sourceLocation: activeLocation,
    neighboringContext: activeContext,
    claimVerdicts,
    supportingPassages,
  };
}

/**
 * Stage D: Claim–Evidence Verifier.
 * Executes structured verification comparing scientific meaning, numbers, and limitations.
 * Uses AI verification with OpenRouter when configured, falling back safely to deterministic verification.
 */
export async function verifyClaimEvidence(
  claim: ClaimDecomposition,
  passage: EvidencePassage,
  _consistency?: ConsistencyReport,
  options?: { apiKey?: string; modelId?: string },
): Promise<VerificationResult> {
  const deterministicFallback = verifyClaimDeterministically(claim, passage);

  // If deterministic check flags a hard contradiction, uphold it
  if (deterministicFallback.label === "CONTRADICTED") {
    return deterministicFallback;
  }

  try {
    let apiKey = options?.apiKey;
    let modelId = options?.modelId;

    if (!apiKey || !modelId) {
      const aiConfig = await getAiTaskConfig("chat");
      apiKey = aiConfig.apiKey ?? undefined;
      modelId = aiConfig.modelId ?? undefined;
    }

    if (!apiKey || !modelId) {
      return deterministicFallback;
    }

    const openrouter = createOpenRouter({ apiKey });

    const prompt = `You are a rigorous academic peer-review verifier evaluating whether a scientific source passage genuinely supports a written statement.

Statement to Verify:
"${claim.originalClaim}"

Subclaims:
${claim.subclaims.map((s, i) => `[${i + 1}] ${s}`).join("\n")}
Claim Category: ${claim.claimCategory}
Numerical Values Required: ${claim.numericalValues.map((n) => `${n.raw} (${n.unit || "unitless"})`).join(", ") || "None"}
Causal Assertion: ${claim.hasCausalClaim ? `Yes (${claim.causalMarkers.join(", ")})` : "No"}

Candidate Source:
Title: "${passage.reference.title}" (${passage.reference.year || "n.d."})
Location: ${passage.sourceLocation}
Passage Text:
"${passage.text}"
${passage.neighboringContext ? `Surrounding Context:\n"${passage.neighboringContext}"` : ""}

Verification Standards:
1. SUPPORTED: The passage directly reports and validates the stated finding, numbers, and conclusions.
2. PARTIALLY_SUPPORTED: The passage establishes some subclaims, but other material details are missing or unverified.
3. RELATED_BUT_UNSUPPORTED: The passage discusses the same topic or keywords, but DOES NOT report or prove this specific result.
4. CONTRADICTED: The passage reports data or conclusions that conflict with or refute the statement.
5. INSUFFICIENT_CONTEXT: The text is incomplete, cut off, or lacks the necessary context to determine validity.

Rules:
- Never assume support just because keywords or domain terminology match.
- Check if numbers, units, and conditions match exactly.
- Do not mistake correlation for causation.
- Never invent quotations. "exactQuote" must be an exact substring from the passage.

Respond ONLY with valid JSON matching this schema:
{
  "label": "SUPPORTED" | "PARTIALLY_SUPPORTED" | "RELATED_BUT_UNSUPPORTED" | "CONTRADICTED" | "INSUFFICIENT_CONTEXT",
  "supportedSubclaims": ["exact subclaim strings that are verified"],
  "unsupportedSubclaims": ["exact subclaim strings not established"],
  "exactQuote": "verbatim quotation from the passage",
  "reasoning": "concise 1-2 sentence peer-review justification",
  "confidenceScore": 85
}`;

    const response = await generateText({
      model: openrouter(modelId),
      prompt,
      temperature: 0.0,
      maxOutputTokens: 600,
      abortSignal: AbortSignal.timeout(8000),
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return deterministicFallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validLabels: EvidenceVerificationLabel[] = [
      "SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "RELATED_BUT_UNSUPPORTED",
      "CONTRADICTED",
      "INSUFFICIENT_CONTEXT",
    ];

    if (!validLabels.includes(parsed.label)) {
      return deterministicFallback;
    }

    // Verify exact quote actually exists in passage
    let cleanQuote = typeof parsed.exactQuote === "string" ? parsed.exactQuote.trim() : "";
    if (!cleanQuote || !passage.text.includes(cleanQuote)) {
      cleanQuote = deterministicFallback.exactQuote;
    }

    // If deterministic consistency check flagged discrepancy (e.g. wrong number or causal overreach),
    // prevent AI from hallucinating complete SUPPORTED status
    let finalLabel: EvidenceVerificationLabel = parsed.label;
    const consistency = verifyConsistency(claim, passage.text);
    if (finalLabel === "SUPPORTED" && !consistency.passed) {
      finalLabel = "PARTIALLY_SUPPORTED";
    }

    const score = typeof parsed.confidenceScore === "number" ? Math.max(10, Math.min(99, parsed.confidenceScore)) : deterministicFallback.confidenceScore;

    return {
      label: finalLabel,
      supportedSubclaims: Array.isArray(parsed.supportedSubclaims) ? parsed.supportedSubclaims : deterministicFallback.supportedSubclaims,
      unsupportedSubclaims: Array.isArray(parsed.unsupportedSubclaims) ? parsed.unsupportedSubclaims : deterministicFallback.unsupportedSubclaims,
      contradictedSubclaims: finalLabel === "CONTRADICTED" ? claim.subclaims : [],
      exactQuote: cleanQuote,
      reasoning: parsed.reasoning || deterministicFallback.reasoning,
      confidence: score >= 80 ? "high" : score >= 60 ? "medium" : "low",
      confidenceScore: score,
      abstained: finalLabel === "INSUFFICIENT_CONTEXT",
      abstentionReason: finalLabel === "INSUFFICIENT_CONTEXT" ? "Context inadequate for reliable verification." : undefined,
    };
  } catch (err) {
    console.warn("[claim-verifier] Model verification error, using deterministic rules:", err);
    return deterministicFallback;
  }
}
