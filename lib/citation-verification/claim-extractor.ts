import type { ClaimDecomposition, DraftContext } from "./types";

const CAUSAL_CONNECTORS = [
  /\bcauses?\b/i,
  /\bcaused by\b/i,
  /\bleads? to\b/i,
  /\bresults? in\b/i,
  /\bdriven by\b/i,
  /\bdrives?\b/i,
  /\binduces?\b/i,
  /\baccounts? for\b/i,
  /\bdue to\b/i,
  /\bbecause of\b/i,
  /\btriggers?\b/i,
  /\byields?\b/i,
  /\bproduces?\b/i,
];

export const CORRELATIONAL_CONNECTORS = [
  /\bassociated with\b/i,
  /\bcorrelated with\b/i,
  /\blinked to\b/i,
  /\bcoincides? with\b/i,
  /\bparallels?\b/i,
  /\brelates? to\b/i,
];

const COMPARATIVE_MARKERS = [
  /\bhigher than\b/i,
  /\blower than\b/i,
  /\bgreater than\b/i,
  /\bless than\b/i,
  /\bmore than\b/i,
  /\bcompared to\b/i,
  /\bin contrast\b/i,
  /\bwhereas\b/i,
  /\bwhile\b/i,
  /\bexceeds?\b/i,
  /\boutperforms?\b/i,
];

const LIMITATION_MARKERS = [
  /\bunder the condition\b/i,
  /\bunder\s+[a-z0-9_-]+\s+scenario\b/i,
  /\bassuming\b/i,
  /\bonly when\b/i,
  /\blimited to\b/i,
  /\brestricted to\b/i,
  /\buncertainty\b/i,
  /\bpotential error\b/i,
  /\bapproximate\b/i,
  /\bpreliminary\b/i,
];

const METHOD_MARKERS = [
  /\bwe used\b/i,
  /\busing\b/i,
  /\bcalibrated with\b/i,
  /\bformulation\b/i,
  /\bmodel\b/i,
  /\balgorithm\b/i,
  /\bframework\b/i,
  /\btechnique\b/i,
  /\bprotocol\b/i,
];

/**
 * Extracts numerical values, percentages, ranges, operators, and scientific units from claim text.
 */
export function extractNumericalValues(text: string): ClaimDecomposition["numericalValues"] {
  const results: ClaimDecomposition["numericalValues"] = [];

  // 1. Percentages: e.g. 15%, 23.5 %
  const pctRegex = /\b(\d+(?:\.\d+)?)\s*%/g;
  let match: RegExpExecArray | null;
  while ((match = pctRegex.exec(text)) !== null) {
    results.push({
      raw: match[0],
      value: parseFloat(match[1]),
      unit: "%",
    });
  }

  // 2. Numerical intervals with scientific units: e.g. 40–50 s m^(-1), 40 to 50 seconds per meter, 10-20 mg/kg
  const intervalRegex = /\b(\d+(?:\.\d+)?)\s*(?:[-–—]|\bto\b)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z0-9_\-^/()]+(?:\s+[a-zA-Z0-9_\-^/()]+)*)?/gi;
  while ((match = intervalRegex.exec(text)) !== null) {
    const minVal = parseFloat(match[1]);
    const maxVal = parseFloat(match[2]);
    const unit = match[3]?.trim();
    results.push({
      raw: match[0],
      value: (minVal + maxVal) / 2,
      min: minVal,
      max: maxVal,
      unit: unit || undefined,
      operator: "range",
    });
  }

  // 3. Standalone measurements with units: e.g. 70 s m^(-1), 70 seconds per meter, 250 mg, 145 K, 145 C, 37 C, 500 Wh/kg
  const unitRegex = /\b(\d+(?:\.\d+)?)\s*(°?[CFK]\b|celsius|kelvin|wh\/kg|nm|seconds\s+per\s+meter|sec\s+per\s+meter|s\s*m\^?\(?-?\d*\)?|sm-1|sm−1|kg|km|m\b|g\b|mg|ml|k\b|v\b|ppm|ppb|w\/m\^?2|j\/kg|bar|kpa|mpa|gpa|hz|ghz|v|mv)\b/gi;
  while ((match = unitRegex.exec(text)) !== null) {
    // Avoid re-matching numbers already covered in percentage or range
    if (!results.some((r) => r.raw.includes(match![0]))) {
      results.push({
        raw: match[0],
        value: parseFloat(match[1]),
        unit: match[2].trim(),
      });
    }
  }

  // 4. Statistical parameters: p < 0.05, r = 0.85, n = 120
  const statRegex = /\b([prn])\s*([<>=])\s*(0?\.\d+|\d+)\b/gi;
  while ((match = statRegex.exec(text)) !== null) {
    results.push({
      raw: match[0],
      value: parseFloat(match[3]),
      unit: match[1].toLowerCase(),
      operator: match[2],
    });
  }

  return results;
}

/**
 * Extracts named scientific entities, datasets, models, and acronyms (e.g. SSP5-8.5, Penman–Monteith, VPD).
 */
export function extractEntities(text: string): string[] {
  const entities = new Set<string>();

  // Acronyms & technical abbreviations: 2+ uppercase letters (e.g. VPD, LAI, PET, CO2, RMSE)
  const acronyms = text.match(/\b[A-Z0-9_]{2,}(?:-[A-Z0-9_]+)*\b/g) || [];
  for (const ac of acronyms) {
    if (!["THE", "AND", "FOR", "WITH"].includes(ac)) {
      entities.add(ac);
    }
  }

  // Proper noun phrases / Model names (e.g., Penman–Monteith, SSP5-8.5, Gaussian process)
  const namedModels = text.match(/\b[A-Z][a-zA-Z0-9]*(?:[-–—][A-Z][a-zA-Z0-9]*)+\b/g) || [];
  for (const nm of namedModels) {
    entities.add(nm);
  }

  // Author mentions (e.g., Kim et al., Smith and colleagues)
  const authorMentions = text.match(/\b[A-Z][a-zA-Z]+(?:\s+et\s+al\.?|\s+and\s+[A-Z][a-zA-Z]+)/g) || [];
  for (const am of authorMentions) {
    entities.add(am);
  }

  return Array.from(entities);
}

/**
 * Splits compound claims into independently verifiable subclaims.
 */
export function extractSubclaims(text: string): string[] {
  // Split on clause connectors like "while", "whereas", "which results in", "leading to", "and thereby"
  // and coordinate action predicates joined by 'and'
  const rawParts = text
    .split(/(?:,\s*(?:while|whereas|which|thereby|leading to|resulting in)\s+|\s*;\s*|\.\s+|\s+and\s+(?=(?:also\s+)?(?:inhibited|suppressed|increased|decreased|outperformed|demonstrated|achieved|reported|tested|observed|exhibited|reduced|induced)\b))/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 15);

  if (rawParts.length <= 1) {
    return [text.trim()];
  }

  return rawParts;
}

const ANAPHORIC_PATTERNS = [
  /^(?:the|these|such|this)\s+(?:results?|findings?|approach|models?|framework|datasets?|records?|experiments?|observations?|mechanisms?|studies|data|work|analysis|evidence)\b/i,
  /^(?:they|it|these|this|both|all)\s+(?:reveal|show|demonstrate|indicate|suggest|prove|provide|confirm|exhibit|explain)\b/i,
];

/**
 * Stage A Claim Decomposition: Parses full scientific statement into structured verification components.
 * When DraftContext is provided, resolves anaphoric references (e.g. "The results reveal...") using
 * preceding sentences and section headings.
 */
export function extractScientificClaim(claimText: string, context?: DraftContext): ClaimDecomposition {
  const clean = claimText.trim();
  const subclaims = extractSubclaims(clean);
  const entities = extractEntities(clean);
  const numericalValues = extractNumericalValues(clean);

  // Extract contextual discourse anchors if provided
  const contextEntities: string[] = [];
  if (context?.precedingText) {
    const precedingEntities = extractEntities(context.precedingText);
    for (const pe of precedingEntities) {
      if (!contextEntities.includes(pe)) contextEntities.push(pe);
    }
  }
  if (context?.sectionHeading) {
    const headingEntities = extractEntities(context.sectionHeading);
    for (const he of headingEntities) {
      if (!contextEntities.includes(he)) contextEntities.push(he);
    }
  }

  // Anaphora Resolution: If statement starts with "The results", "This approach", or lacks entities,
  // enrich entities with discourse anchors from preceding sentences
  const isAnaphoric = ANAPHORIC_PATTERNS.some((p) => p.test(clean));
  if ((isAnaphoric || entities.length === 0) && contextEntities.length > 0) {
    for (const ce of contextEntities) {
      if (!entities.includes(ce)) {
        entities.push(ce);
      }
    }
  }

  // Check for causal relationships
  const causalMarkers: string[] = [];
  for (const r of CAUSAL_CONNECTORS) {
    const m = clean.match(r);
    if (m) causalMarkers.push(m[0]);
  }
  const hasCausalClaim = causalMarkers.length > 0;

  // Check for comparative statements
  const isComparative = COMPARATIVE_MARKERS.some((r) => r.test(clean));

  // Extract conditions and limitations
  const conditionsAndLimitations: string[] = [];
  for (const r of LIMITATION_MARKERS) {
    const m = clean.match(r);
    if (m) conditionsAndLimitations.push(m[0]);
  }

  // Categorize claim type
  let claimCategory: ClaimDecomposition["claimCategory"] = "empirical_result";
  if (hasCausalClaim) {
    claimCategory = "causal_explanation";
  } else if (numericalValues.length > 0) {
    claimCategory = "statistical";
  } else if (METHOD_MARKERS.some((r) => r.test(clean))) {
    claimCategory = "method";
  } else if (/\b(?:well known|widely understood|conventional|traditionally)\b/i.test(clean)) {
    claimCategory = "background";
  }

  return {
    originalClaim: clean,
    mainClaim: subclaims[0] || clean,
    subclaims,
    entities,
    contextEntities: contextEntities.length > 0 ? contextEntities : undefined,
    numericalValues,
    hasCausalClaim,
    causalMarkers,
    isComparative,
    claimCategory,
    conditionsAndLimitations,
  };
}
