import type { ClaimDecomposition, ConsistencyReport } from "./types";
import { extractNumericalValues } from "./claim-extractor";

/**
 * Normalizes equivalent scientific units for safe comparison.
 * e.g., 's m^(-1)' <=> 's/m' <=> 's m^-1' <=> 'seconds per meter', '%' <=> 'percent'.
 */
export function normalizeUnit(rawUnit?: string): string {
  if (!rawUnit) return "";
  const clean = rawUnit
    .toLowerCase()
    .replace(/[\s°~_]/g, "")
    .replace(/[\u2212\u2013\u2014-]/g, "-");

  if (clean === "%" || clean === "percent" || clean === "percentage") return "%";
  if (clean === "c" || clean === "celsius") return "c";
  if (clean === "k" || clean === "kelvin") return "k";
  if (clean === "f" || clean === "fahrenheit") return "f";
  if (
    clean === "sm^(-1)" ||
    clean === "sm^-1" ||
    clean === "s/m" ||
    clean === "sm-1" ||
    clean === "sm" ||
    clean === "secondspermeter" ||
    clean === "secondpermeter" ||
    clean === "sec/m" ||
    clean === "secpermeter"
  ) {
    return "s/m";
  }
  if (
    clean === "w/m^2" ||
    clean === "w/m2" ||
    clean === "wm^(-2)" ||
    clean === "wm^-2" ||
    clean === "wm-2" ||
    clean === "watts/m2" ||
    clean === "wattspermeter2" ||
    clean === "wattspermetersquared"
  ) {
    return "w/m2";
  }
  if (clean === "wh/kg" || clean === "whkg-1" || clean === "whkg^-1") return "wh/kg";
  if (clean === "kg" || clean === "kilogram" || clean === "kilograms") return "kg";
  if (clean === "km" || clean === "kilometer" || clean === "kilometers") return "km";
  if (clean === "m" || clean === "meter" || clean === "meters") return "m";
  if (clean === "mg" || clean === "milligram") return "mg";
  return clean;
}

/**
 * Standard scientific notation and variable equivalence map.
 * Connects standard mathematical/empirical notation with full prose descriptions.
 */
export const SCIENTIFIC_SYNONYM_MAP: Record<string, string[]> = {
  "surface resistance": ["rs", "r_s", "$r_s$", "$r_{s}$", "aerodynamic resistance", "canopy resistance"],
  "seconds per meter": ["s/m", "s m-1", "s m − 1", "s m^-1", "sm-1", "sm−1", "sm^-1", "sm"],
  "potential evapotranspiration": ["pet", "wetveg", "penman-monteith"],
  "actual evapotranspiration": ["aet", "et"],
  "vapor pressure deficit": ["vpd"],
  "leaf area index": ["lai"],
  "smart water grid": ["swg"],
  "penman monteith": ["penman-monteith", "pm"],
  "carbon dioxide": ["co2"],
  "climb": ["increase", "increases", "rise", "rises", "rising", "grow", "growth", "elevate", "anomalies", "positive anomaly"],
  "climbs": ["increase", "increases", "rise", "rises", "rising", "grow", "growth", "elevate"],
  "projected": ["projections", "project", "scenario", "ssp", "future", "simulated", "models"],
  "roughly": ["approximately", "about", "around", "near"],
  "approximately": ["roughly", "about", "around", "near"],
  "end of the century": ["end of the 21st century", "21st century", "21 st century", "century"],
};

/**
 * Checks polarity (direction of finding):
 * Flags contradictions if claim asserts an increase but evidence reports a decrease (or vice-versa),
 * or if claim asserts a significant effect but evidence reports no effect.
 */
export function checkPolarity(claimText: string, passageText: string): { matches: boolean; discrepancy?: string } {
  const claimLower = claimText.toLowerCase();
  const passageLower = passageText.toLowerCase();

  // Pre-process passage to prevent false negative triggers
  // e.g., "without degradation", "no reduction", "reducing harmful completion rates"
  const sanitizedPassage = passageLower
    .replace(/\bwithout\s+(?:any\s+)?(?:statistically\s+significant\s+)?(?:degradation|impairment|reduction|adverse|harm|decrease|loss|drop|difference)\b/gi, "")
    .replace(/\bno\s+(?:degradation|impairment|reduction|adverse|harm|loss)\b/gi, "")
    .replace(/\breduc\w+\s+(?:harmful|toxic|error|flaws?|risks?|adverse|failure|mortality)\b/gi, "mitigating_harm");

  const posWordsRegex = "(?:increased?|higher|growth|elevated|rises?|rising|amplif\\w+|enhanced?|improv\\w+|boost\\w+|advanc\\w+|accelerat\\w+|stimulat\\w+|activat\\w+|upregulat\\w+|exacerbat\\w+|broaden\\w+|prolong\\w+)";
  const negWordsRegex = "(?:decreased?|lower|reduction|declined?|drops?|dropping|diminished?|attenuat\\w+|degrad\\w+|impair\\w+|worsen\\w+|reduced?|decelerat\\w+|slow\\w+|inhib\\w+|suppress\\w+|downregulat\\w+|mitigat\\w+|ameliorat\\w+|narrow\\w+|shorten\\w+)";

  const claimPositive = new RegExp(`\\b${posWordsRegex}\\b`, "i").test(claimLower);
  const claimNegative = new RegExp(`\\b${negWordsRegex}\\b`, "i").test(claimLower);

  const passagePositive = new RegExp(`\\b${posWordsRegex}\\b`, "i").test(sanitizedPassage);
  const passageNegative = new RegExp(`\\b${negWordsRegex}\\b`, "i").test(sanitizedPassage);

  // Target-specific polarity contradiction
  // e.g. claim: "degrades safety alignment" vs passage: "improved safety alignment"
  const claimNegTargetMatch = new RegExp(`\\b${negWordsRegex}\\s+(?:(?:the|a|an|in|of|on)\\s+)?([a-z]+(?:\\s+[a-z]+)?)`, "i").exec(claimLower);
  const claimPosTargetMatch = new RegExp(`\\b${posWordsRegex}\\s+(?:(?:the|a|an|in|of|on)\\s+)?([a-z]+(?:\\s+[a-z]+)?)`, "i").exec(claimLower);

  if (claimNegTargetMatch) {
    const target = claimNegTargetMatch[1].trim();
    if (target && target.length > 3) {
      const passagePosTargetRegex = new RegExp(`\\b${posWordsRegex}\\s+(?:(?:the|a|an|in|of|on|substantially|significantly|markedly|consistently)\\s+)?(?:[a-z]+\\s+)?${target}`, "i");
      if (passagePosTargetRegex.test(sanitizedPassage)) {
        return {
          matches: false,
          discrepancy: `Directional conflict: Claim asserts negative effect on "${target}", but evidence reports an improvement/increase.`,
        };
      }
    }
  }

  if (claimPosTargetMatch) {
    const target = claimPosTargetMatch[1].trim();
    if (target && target.length > 3) {
      const passageNegTargetRegex = new RegExp(`\\b${negWordsRegex}\\s+(?:(?:the|a|an|in|of|on|substantially|significantly|markedly|consistently)\\s+)?(?:[a-z]+\\s+)?${target}`, "i");
      if (passageNegTargetRegex.test(sanitizedPassage)) {
        return {
          matches: false,
          discrepancy: `Directional conflict: Claim asserts positive effect on "${target}", but evidence reports a decrease/degradation.`,
        };
      }
    }
  }

  // Overestimation vs Underestimation
  const claimOver = /\b(overestimat\w+|over-estimat\w+)\b/i.test(claimLower);
  const claimUnder = /\b(underestimat\w+|under-estimat\w+)\b/i.test(claimLower);
  const passageOver = /\b(overestimat\w+|over-estimat\w+)\b/i.test(sanitizedPassage);
  const passageUnder = /\b(underestimat\w+|under-estimat\w+)\b/i.test(sanitizedPassage);

  if ((claimOver && passageUnder && !passageOver) || (claimUnder && passageOver && !passageUnder)) {
    return {
      matches: false,
      discrepancy: "Directional conflict: Claim asserts estimation in one direction, but passage reports the opposite (overestimation vs underestimation).",
    };
  }

  // If claim asserts clear increase/amplification, but passage only states decrease/attenuation (or vice versa)
  if (claimPositive && !claimNegative && passageNegative && !passagePositive) {
    return {
      matches: false,
      discrepancy: "Directional conflict: Claim asserts an increase/amplification, but passage reports a decrease/attenuation.",
    };
  }

  if (claimNegative && !claimPositive && passagePositive && !passageNegative) {
    return {
      matches: false,
      discrepancy: "Directional conflict: Claim asserts a decrease/attenuation, but passage reports an increase/amplification.",
    };
  }

  // Check explicit negation (e.g., "no statistically significant effect", "had no effect", "failed to replicate", "statistically indistinguishable from zero")
  if (
    (claimPositive || claimNegative || /\bsignificantly\b/i.test(claimLower)) &&
    /\b(no\s+(?:statistically\s+)?significant\s+(?:effect|difference|increase|reduction|mortality|change|alteration)|had\s+no\s+(?:detectable\s+)?effect|did\s+not\s+(?:significantly\s+)?(?:reduce|increase|improve|affect|alter)|failed\s+to\s+replicate|no\s+evidence\s+of|indistinguishable\s+from\s+zero|was\s+not\s+(?:significantly\s+)?associated\s+with)\b/i.test(passageLower)
  ) {
    return {
      matches: false,
      discrepancy: "Contradiction: Passage reports no statistically significant effect or failed to replicate, whereas claim asserts an effect.",
    };
  }

  return { matches: true };
}

/**
 * Checks for experimental model domain boundary mismatch.
 * Flags when claim specifies human clinical subjects or patients,
 * but evidence passage is exclusively from pre-clinical animal models (mice, rats, cell lines).
 */
export function checkExperimentalModel(claimText: string, passageText: string): { matches: boolean; warning?: string } {
  const claimLower = claimText.toLowerCase();
  const passageLower = passageText.toLowerCase();

  const claimHuman = /\b(patients?|humans?|human\s+subjects?|clinical\s+cohort|clinical\s+trials?)\b/i.test(claimLower);
  const passagePreclinical = /\b(mice|mouse|murine|c57bl\/6|rats?|rodents?|in\s+vitro|cell\s+culture|hela|hek293)\b/i.test(passageLower);
  const passageHuman = /\b(patients?|humans?|clinical\s+trial|clinical\s+cohort|participants?)\b/i.test(passageLower);

  if (claimHuman && passagePreclinical && !passageHuman) {
    return {
      matches: false,
      warning: "Model boundary alert: Claim asserts findings in human patients, but evidence is from pre-clinical murine or in vitro cell models.",
    };
  }

  return { matches: true };
}

/**
 * Checks causal vs correlational relationship:
 * Flags causal overreach if the claim asserts causality ('causes', 'drives', 'induces')
 * but the passage only demonstrates correlation or association ('correlated with', 'associated with').
 */
export function checkCausality(claim: ClaimDecomposition, passageText: string): { matches: boolean; warning?: string } {
  if (!claim.hasCausalClaim) {
    return { matches: true };
  }

  const passageLower = passageText.toLowerCase();

  // Explicit causal verbs in evidence
  const passageHasCausality = /\b(causes?|caused by|leads? to|results? in|driven by|drives?|induces?|triggers?)\b/i.test(passageLower);
  const passageOnlyCorrelational =
    /\b(associated with|correlated with|linked to|coincides? with|parallels?|statistical association|potential reverse causality|cannot be inferred|cannot be established)\b/i.test(passageLower) &&
    !passageHasCausality;

  if (passageOnlyCorrelational) {
    return {
      matches: false,
      warning: `Causal overreach: Claim asserts direct causality (${claim.causalMarkers.join(", ")}), but passage only demonstrates correlational association without established causation.`,
    };
  }

  return { matches: true };
}

/**
 * Checks numerical and unit consistency between decomposed claim values and evidence passage.
 */
export function checkNumericalConsistency(
  claim: ClaimDecomposition,
  passageText: string,
): { numericalMatch: boolean; unitMatch: boolean; discrepancies: string[] } {
  const discrepancies: string[] = [];
  if (claim.numericalValues.length === 0) {
    return { numericalMatch: true, unitMatch: true, discrepancies };
  }

  const passageNumbers = extractNumericalValues(passageText);

  for (const claimNum of claim.numericalValues) {
    // Look for matching number in passage (support single numbers and range intervals)
    const matchingNumber = passageNumbers.find((p) => {
      // 1. Direct equality or within small tolerance for rounded numbers (e.g. 15.0 vs 15)
      if (Math.abs(p.value - claimNum.value) < 0.1) return true;
      // 2. Interval/range matching
      if (claimNum.min !== undefined && claimNum.max !== undefined) {
        if (p.min !== undefined && p.max !== undefined) {
          return Math.abs(p.min - claimNum.min) < 0.1 && Math.abs(p.max - claimNum.max) < 0.1;
        }
      }
      return false;
    }) || (
      // Or passage contains both interval endpoints as separate values
      claimNum.min !== undefined && claimNum.max !== undefined &&
      passageNumbers.some((p) => Math.abs(p.value - claimNum.min!) < 0.1) &&
      passageNumbers.some((p) => Math.abs(p.value - claimNum.max!) < 0.1)
        ? passageNumbers.find((p) => Math.abs(p.value - claimNum.max!) < 0.1)
        : undefined
    );

    if (!matchingNumber) {
      // Check if passage contains contradictory numbers with the same unit
      const normClaimUnit = normalizeUnit(claimNum.unit);
      const conflictingNumbersWithUnit = passageNumbers.filter(
        (p) => normalizeUnit(p.unit) === normClaimUnit && Math.abs(p.value - claimNum.value) >= 0.5,
      );

      if (conflictingNumbersWithUnit.length > 0) {
        discrepancies.push(
          `Numerical mismatch: Claim states ${claimNum.raw}, but passage reports ${conflictingNumbersWithUnit.map((p) => p.raw).join(", ")}.`,
        );
      } else {
        discrepancies.push(
          `Unverified quantitative claim: Passage does not contain the reported numerical value (${claimNum.raw}).`,
        );
      }
    } else {
      // Check unit consistency using normalized scientific units
      const normClaimUnit = normalizeUnit(claimNum.unit);
      const normPassageUnit = normalizeUnit(matchingNumber.unit);
      if (normClaimUnit && normPassageUnit && normClaimUnit !== normPassageUnit) {
        discrepancies.push(
          `Unit mismatch: Claim specifies '${claimNum.unit}', but passage reports '${matchingNumber.unit}'.`,
        );
      }
    }
  }

  const numericalMatch = discrepancies.filter((d) => d.includes("Numerical mismatch") || d.includes("Unverified quantitative")).length === 0;
  const unitMatch = discrepancies.filter((d) => d.includes("Unit mismatch") || d.includes("Unit discrepancy")).length === 0;

  return { numericalMatch, unitMatch, discrepancies };
}

/**
 * Checks for unwarranted universal / absolute claims:
 * Flags when claim uses 'always', 'proves', 'consistently' but passage notes specific conditions.
 */
export function checkAbsoluteLanguage(claimText: string, passageText: string): { warnings: string[] } {
  const warnings: string[] = [];
  const claimLower = claimText.toLowerCase();
  const passageLower = passageText.toLowerCase();

  const hasAbsolute = /\b(always|proves|conclusively proves|in all cases|universal|guaranteed)\b/i.test(claimLower);
  const passageHasConditions = /\b(under specific conditions|in preliminary trials|only in|dependent on|further study is needed|limitations)\b/i.test(passageLower);

  if (hasAbsolute && passageHasConditions) {
    warnings.push(
      "Overgeneralized claim: Claim uses absolute terms ('always'/'proves'), but evidence notes specific conditions or limitations.",
    );
  }

  return { warnings };
}

/**
 * Stage E: Evaluates deterministic numerical, unit, causal, and polarity consistency.
 */
export function verifyConsistency(
  claim: ClaimDecomposition,
  passageText: string,
): ConsistencyReport {
  const discrepancies: string[] = [];
  const warnings: string[] = [];

  // 1. Polarity / Direction check
  const polarity = checkPolarity(claim.originalClaim, passageText);
  if (!polarity.matches && polarity.discrepancy) {
    discrepancies.push(polarity.discrepancy);
  }

  // 2. Numerical & Unit check
  const numCheck = checkNumericalConsistency(claim, passageText);
  discrepancies.push(...numCheck.discrepancies);

  // 3. Causality vs Correlation check
  const causality = checkCausality(claim, passageText);
  if (!causality.matches && causality.warning) {
    discrepancies.push(causality.warning);
    warnings.push(causality.warning);
  }

  // 4. Absolute language check
  const absoluteCheck = checkAbsoluteLanguage(claim.originalClaim, passageText);
  warnings.push(...absoluteCheck.warnings);

  // 5. Experimental model check (animal vs human)
  const modelCheck = checkExperimentalModel(claim.originalClaim, passageText);
  if (!modelCheck.matches && modelCheck.warning) {
    warnings.push(modelCheck.warning);
    discrepancies.push(modelCheck.warning);
  }

  const passed = discrepancies.length === 0;

  return {
    passed,
    numericalMatch: numCheck.numericalMatch,
    unitMatch: numCheck.unitMatch,
    causalityMatch: causality.matches,
    polarityMatch: polarity.matches,
    discrepancies,
    warnings,
  };
}

export const checkDeterministicConsistency = verifyConsistency;

