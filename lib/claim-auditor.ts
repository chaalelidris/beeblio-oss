/**
 * Uncited Claim Auditor with Citation Placement & Academic Best Practices:
 * 1. Place citations immediately after the sentence or at the end of a paragraph they support.
 * 2. Use one citation at the end of a paragraph only when all claims in that paragraph are supported
 *    by the same source and attribution is unambiguous.
 * 3. If claims come from different sources, cite each sentence or relevant claim separately.
 * 4. Never add citations without verifying that the referenced source supports the associated claims.
 * 5. Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.
 */

export type UncitedClaim = {
  id: string;
  text: string;
  from: number;
  to: number;
  signal?: string;
  category?: "statistic" | "finding" | "literature" | "empirical" | "consensus";
  requiresMultipleSources?: boolean;
  q1Guideline?: string;
  paragraphIndex?: number;
  existingCitationKeys?: string[];
  partOfStudySummary?: boolean;
  precedingText?: string;
  sectionHeading?: string;
  paragraphText?: string;
};

/**
 * Detects whether a sentence contains a specific quantitative measurement,
 * percentage, metric, or technical parameter that warrants a direct proximate citation.
 */
export function isSpecificStatisticClaim(text: string): boolean {
  return (
    /\b\d+(?:\.\d+)?\s*%(?:\s|[.,;:]|$)/.test(text) ||
    /\b\d+(?:\.\d+)?\s*(?:[-–—]|\bto\b)\s*\d+(?:\.\d+)?\s*(?:s\s*m|s\/m|%|kg|km|m\b|g\b|mg|ml|k\b|v\b|ppm|ppb|w\/m|j\/kg)/i.test(text) ||
    /\b(?:p\s*[<>=]\s*0?\.\d+|r\s*=\s*-?0?\.\d+|n\s*=\s*\d+)/i.test(text) ||
    /(?:reaching|reached|increased\s+by|reduced\s+by|declined\s+by|improved\s+by|climbed(?:\s+to)?|rose(?:\s+to)?|dropped(?:\s+to)?|anomaly\s+of|value\s+of)\s+(?:approximately\s+|roughly\s+|about\s+)?\d+/i.test(text)
  );
}

// Citation patterns in Markdown, LaTeX, and academic writing
export const CITATION_PATTERNS = [
  /\[@[a-zA-Z0-9_:.#$%&\-+?<>~/]+(?:\s*;\s*@[a-zA-Z0-9_:.#$%&\-+?<>~/]+)*\]/, // [@key]
  /\\cite[tp]?\*?(?:\[.*?\])?\{[a-zA-Z0-9_:,\s-]+\}/, // \cite{key}
  /\[\d+(?:[–—,-]\s*\d+)*\]/, // [1], [8], [9–18]
  /\([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?,\s*(?:19|20)\d{2}[a-z]?\)/, // (Author et al., 2023)
  /\([A-Z][a-zA-Z]+\s+(?:19|20)\d{2}[a-z]?\)/, // (Author 2023)
];

// Disparate study transitions and comparative markers indicating multiple distinct studies (Rule 5 & Rule 3)
// We avoid flagging ordinary within-paper rhetorical contrasts ("In contrast, higher resistance was observed...")
// unless it explicitly references external/prior studies or author works.
export const DISPARATE_STUDY_TRANSITIONS = [
  /\b(?:in contrast to (?:previous|prior|earlier|other)|differing from (?:previous|prior|earlier|other))\b/i,
  /\b(?:another study|other studies|a separate study|different findings from|competing findings)\b/i,
  /\b(?:earlier work|subsequent research|in another work|in a related study)\b/i,
];

// Terms indicating consensus, broad literature claims, or research gaps (Rule 4)
export const CONSENSUS_TERMS = [
  "several studies",
  "multiple studies",
  "numerous studies",
  "many studies",
  "growing body of literature",
  "growing evidence",
  "widespread consensus",
  "broad consensus",
  "widely accepted",
  "conflicting reports",
  "conflicting evidence",
  "conflicting findings",
  "research gap",
  "literature consensus",
  "across various trials",
  "across different experiments",
  "systematic reviews indicate",
  "meta-analyses show",
  "meta-analysis shows",
  "accumulating evidence",
  "competing theories",
  "contrasting views",
];

export const AUTHOR_MENTION_REGEX =
  /\b[A-Z][a-zA-Z]+(?:\s+et\s+al\.?|\s+and\s+colleagues|\s+and\s+coworkers|\s+and\s+[A-Z][a-zA-Z]+)/g;

const EMPIRICAL_VERBS = [
  "show",
  "shows",
  "showed",
  "demonstrate",
  "demonstrates",
  "demonstrated",
  "found",
  "finds",
  "observe",
  "observed",
  "observes",
  "indicate",
  "indicates",
  "indicated",
  "reveal",
  "reveals",
  "revealed",
  "confirm",
  "confirms",
  "confirmed",
  "suggest",
  "suggests",
  "suggested",
  "report",
  "reports",
  "reported",
  "conclude",
  "concluded",
  "concludes",
  "argue",
  "argues",
  "argued",
  "propose",
  "proposes",
  "proposed",
  "state",
  "states",
  "stated",
  "established",
  "measured",
  "estimated",
  "calculated",
  "tested",
  "discovered",
  "reflects",
  "represents",
  "exhibits",
  "encompasses",
  "requires",
  "proven",
];

const STATISTICAL_TERMS = [
  "%",
  "percent",
  "percentage",
  "increased",
  "decreased",
  "reduction",
  "growth",
  "rate",
  "average",
  "median",
  "majority",
  "minority",
  "statistically",
  "significant",
  "double",
  "triple",
  "fold",
  "±",
  "uncertainty",
  "ratio",
  "magnitude",
  "correlation",
  "variance",
  "trend",
  "stable",
  "fluctuation",
  "drop",
  "rise",
  "deficit",
  "surplus",
];

const LITERATURE_TERMS = [
  "previous studies",
  "prior work",
  "earlier research",
  "literature shows",
  "literature suggests",
  "conventional wisdom",
  "traditional models",
  "standard practice",
  "historically",
  "documented by",
  "according to",
  "existing frameworks",
  "prior models",
  "past research",
];

const TEMPORAL_EXTENT_TERMS = [
  "over the past",
  "decades",
  "centuries",
  "rarely used",
  "consistently",
  "historically",
  "traditionally",
  "has emerged",
  "remain",
  "remains",
];

// Meta-text phrases that do not require external citations (author's own paper structure)
const META_EXCLUSIONS = [
  /^in this paper/i,
  /^in this section/i,
  /^in this work/i,
  /^we present/i,
  /^we propose/i,
  /^we outline/i,
  /^we organize/i,
  /^figure \d+/i,
  /^table \d+/i,
  /^section \d+/i,
  /^equation \d+/i,
  /^as described below/i,
  /^the remainder of this/i,
];

/**
 * Counts total citations present in a given text block.
 */
export function countCitations(text: string): number {
  let count = 0;
  for (const pattern of CITATION_PATTERNS) {
    const r = new RegExp(pattern.source, "g");
    const m = text.match(r);
    if (m) count += m.length;
  }
  return count;
}

/**
 * Checks if a citation in the sentence represents multiple sources (Rule 4).
 * Supports [@a; @b], [1, 2], [1-4], [1–4], (Smith, 2020; Jones, 2021), or multiple citations.
 */
export function hasMultipleSources(text: string): boolean {
  if (/\[@[^\]]+;[^\]]+\]/.test(text)) return true;
  if (/\[\d+(?:\s*[,–—-]\s*\d+)+\]/.test(text)) return true;
  if (
    /\([^)]*(?:19|20)\d{2}[a-z]?\s*;\s*[^)]*(?:19|20)\d{2}[a-z]?\)/.test(text)
  )
    return true;
  const bracketMatches = text.match(/\[(?:@[a-zA-Z0-9_:.\-+]+|\d+)\]/g);
  if (bracketMatches && bracketMatches.length >= 2) return true;
  return false;
}

/**
 * Checks if a sentence contains or is immediately followed by a citation.
 */
export function hasCitation(
  sentenceText: string,
  contextFollowing = "",
): boolean {
  for (const pattern of CITATION_PATTERNS) {
    if (pattern.test(sentenceText)) return true;
  }
  // Check if a citation directly follows the sentence (e.g. "Sentence text. [8]")
  const immediateFollowing = contextFollowing.slice(0, 35).trim();
  for (const pattern of CITATION_PATTERNS) {
    if (pattern.test(immediateFollowing)) return true;
  }
  return false;
}

/**
 * Categorizes and detects if a sentence makes an empirical, literature, or consensus claim.
 * Implements Rule 1 & Rule 4.
 */
export function detectClaimSignal(sentence: string): {
  isClaim: boolean;
  signal?: string;
  category?: UncitedClaim["category"];
  requiresMultipleSources?: boolean;
  q1Guideline?: string;
} {
  const trimmed = sentence.trim();
  if (trimmed.length < 32) return { isClaim: false };

  // Skip headings or references tags
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("<!--") ||
    trimmed.startsWith("![")
  ) {
    return { isClaim: false };
  }

  // Check meta exclusions (paper structure)
  for (const meta of META_EXCLUSIONS) {
    if (meta.test(trimmed)) return { isClaim: false };
  }

  const lower = trimmed.toLowerCase();

  // 1. Consensus & Synthesis claims (Rule 4: Multiple sources required)
  for (const term of CONSENSUS_TERMS) {
    if (lower.includes(term)) {
      return {
        isClaim: true,
        signal: `Synthesizes literature / consensus ("${term}")`,
        category: "consensus",
        requiresMultipleSources: true,
        q1Guideline:
          "Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
      };
    }
  }

  // 2. Literature reference claims
  for (const term of LITERATURE_TERMS) {
    if (lower.includes(term)) {
      return {
        isClaim: true,
        signal: `Refers to prior literature ("${term}")`,
        category: "literature",
        q1Guideline:
          "Best Practice: If you introduce a new source or make a distinct factual claim, cite it near that claim.",
      };
    }
  }

  // 3. Statistical / Quantitative claims
  if (isSpecificStatisticClaim(trimmed)) {
    return {
      isClaim: true,
      signal: "Contains specific quantitative assertion / statistic",
      category: "statistic",
      q1Guideline:
        "Best Practice: Cite every claim that requires external evidence, not necessarily every sentence.",
    };
  }

  for (const term of STATISTICAL_TERMS) {
    const regex = new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i",
    );
    if (regex.test(lower)) {
      return {
        isClaim: true,
        signal: `Contains quantitative assertion ("${term}")`,
        category: "statistic",
        q1Guideline:
          "Best Practice: Cite every claim that requires external evidence, not necessarily every sentence.",
      };
    }
  }

  // 4. Empirical findings / assertion verbs
  for (const verb of EMPIRICAL_VERBS) {
    const regex = new RegExp(`\\b${verb}\\b`, "i");
    if (regex.test(lower)) {
      return {
        isClaim: true,
        signal: `Makes empirical assertion ("${verb}")`,
        category: "finding",
        q1Guideline:
          "Best Practice: Cite every claim that requires external evidence, not necessarily every sentence.",
      };
    }
  }

  // 5. Temporal extent / historical claims
  for (const term of TEMPORAL_EXTENT_TERMS) {
    if (lower.includes(term)) {
      return {
        isClaim: true,
        signal: `Makes historical assertion ("${term}")`,
        category: "empirical",
      };
    }
  }

  return { isClaim: false };
}

/**
 * Splits a block of text into sentences with accurate character offsets.
 * Uses Intl.Segmenter where available for academic text preservation (e.g. "et al.", "3.5 bar").
 */
export function extractSentences(
  text: string,
  baseOffset = 0,
): { text: string; from: number; to: number; following: string }[] {
  if (
    typeof Intl !== "undefined" &&
    typeof (Intl as any).Segmenter === "function"
  ) {
    try {
      const segmenter = new (Intl as any).Segmenter("en", {
        granularity: "sentence",
      });
      const segments = Array.from(segmenter.segment(text)) as {
        segment: string;
        index: number;
      }[];
      return segments
        .map((s) => {
          const trimmed = s.segment.trim();
          if (!trimmed) return null;
          const leadingSpace = s.segment.indexOf(trimmed);
          const from =
            baseOffset + s.index + (leadingSpace >= 0 ? leadingSpace : 0);
          const to = from + trimmed.length;
          const following = text.slice(s.index + s.segment.length);
          return { text: trimmed, from, to, following };
        })
        .filter(
          (
            s,
          ): s is {
            text: string;
            from: number;
            to: number;
            following: string;
          } => Boolean(s),
        );
    } catch {
      // Fall through to regex-based fallback
    }
  }

  // Fallback regex
  const sentences: {
    text: string;
    from: number;
    to: number;
    following: string;
  }[] = [];
  const regex = /([^.?!]+[.?!]+(?:\s+|$)|[^.?!]+$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const leadingSpace = raw.indexOf(trimmed);
    const from = baseOffset + match.index + leadingSpace;
    const to = from + trimmed.length;
    const following = text.slice(match.index + raw.length);

    sentences.push({
      text: trimmed,
      from,
      to,
      following,
    });
  }

  return sentences;
}

/**
 * Audits a single paragraph in academic draft text enforcing Q1 journal best practices.
 *
 * Rules applied:
 * 1. Cite claims requiring external evidence, not every sentence.
 * 2. If an entire paragraph summarizes one study, a single trailing citation at the end suffices.
 * 3. If introducing a new source or distinct factual claim, cite near that claim.
 * 4. Use multiple sources when establishing consensus or comparing findings.
 * 5. Avoid a single citation at the end of a paragraph containing claims from multiple different studies.
 */
export function auditParagraphClaims(
  paraText: string,
  baseOffset = 0,
  sectionHeading?: string,
): UncitedClaim[] {
  const claims: UncitedClaim[] = [];
  const trimmed = paraText.trim();
  if (trimmed.length < 32) return claims;

  // Skip headers or bibliography blocks
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("<!--")
  ) {
    return claims;
  }

  const sentences = extractSentences(paraText, baseOffset);
  if (sentences.length === 0) return claims;

  const totalCitations = countCitations(paraText);
  const lastSentence = sentences[sentences.length - 1];
  const lastSentenceCited = hasCitation(
    lastSentence.text,
    lastSentence.following,
  );
  const hasDisparateTransitions = DISPARATE_STUDY_TRANSITIONS.some((r) =>
    r.test(paraText),
  );
  const rawAuthorMatches = paraText.match(AUTHOR_MENTION_REGEX) || [];
  const uniqueAuthors = Array.from(new Set(rawAuthorMatches));
  const hasMultipleStudies =
    uniqueAuthors.length >= 2 || hasDisparateTransitions;

  // Rule 2: Single-study summary paragraph
  // In research articles: One source supports the entire paragraph -> One citation may be sufficient.
  // If the paragraph already has a citation and does not introduce contrasting/disparate studies,
  // general sentences summarizing that study do not require duplicate citations in the same paragraph.
  const hasParagraphCitation = totalCitations >= 1;
  const isSingleStudySummary = hasParagraphCitation && !hasMultipleStudies;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const sCited = hasCitation(s.text, s.following);
    const { isClaim, signal, category, q1Guideline } = detectClaimSignal(
      s.text,
    );

    // Rule 1: Only claims requiring external evidence are flagged
    if (!isClaim) continue;

    const commonContext = {
      precedingText: i > 0 ? sentences[i - 1].text : undefined,
      sectionHeading: sectionHeading || undefined,
      paragraphText: paraText,
    };

    // Rule 4: Consensus / Literature Synthesis claims
    if (category === "consensus") {
      if (sCited) {
        const hasMulti =
          hasMultipleSources(s.text) ||
          hasMultipleSources(s.following.slice(0, 35));
        if (!hasMulti) {
          claims.push({
            id: `claim-${baseOffset}-${s.from}`,
            text: s.text,
            from: s.from,
            to: s.to,
            signal: `Consensus claim cited with only 1 source`,
            category: "consensus",
            requiresMultipleSources: true,
            q1Guideline:
              "Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
            ...commonContext,
          });
        }
      } else {
        claims.push({
          id: `claim-${baseOffset}-${s.from}`,
          text: s.text,
          from: s.from,
          to: s.to,
          signal: signal || "Synthesizes literature without citations",
          category: "consensus",
          requiresMultipleSources: true,
          q1Guideline:
            "Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
          ...commonContext,
        });
      }
      continue;
    }

    // Direct citation present on this sentence
    if (sCited) continue;

    // Rule 2 Check: Single-study summary paragraph allows one citation for the whole paragraph
    if (isSingleStudySummary) {
      // If the sentence makes a specific standalone quantitative measurement or statistic,
      // research best practice recommends direct proximate citation.
      // Otherwise, the paragraph's citation covers this study's summary claims.
      const isStat = category === "statistic" || isSpecificStatisticClaim(s.text);
      if (!isStat) {
        continue;
      }
    }

    // Rule 5 Check: Multiple disparate studies amalgamated with only a trailing citation
    if (lastSentenceCited && hasMultipleStudies) {
      claims.push({
        id: `claim-${baseOffset}-${s.from}`,
        text: s.text,
        from: s.from,
        to: s.to,
        signal: signal || "Distinct claim requires proximate citation",
        category,
        q1Guideline:
          "Best Practice: Avoid placing a single citation at the end of a paragraph containing claims from several different studies. Cite each claim near that claim.",
        ...commonContext,
      });
      continue;
    }

    // Rule 3: Distinct factual claim without proximate citation
    claims.push({
      id: `claim-${baseOffset}-${s.from}`,
      text: s.text,
      from: s.from,
      to: s.to,
      signal,
      category,
      q1Guideline:
        q1Guideline ||
        "Best Practice: If you introduce a new source or make a distinct factual claim, cite it near that claim.",
      ...commonContext,
    });
  }

  return claims;
}

/**
 * Audits a document's full markdown content paragraph by paragraph,
 * enforcing Q1 journal best practices.
 */
export function auditDocumentClaims(content: string): UncitedClaim[] {
  const claims: UncitedClaim[] = [];
  const lines = content.split("\n");
  let currentOffset = 0;
  let inCodeBlock = false;
  let inBibliographySection = false;
  let currentHeading = "";

  let currentBlockText = "";
  let currentBlockStart = 0;

  const flushBlock = () => {
    if (currentBlockText.trim().length >= 32) {
      const blockClaims = auditParagraphClaims(
        currentBlockText,
        currentBlockStart,
        currentHeading || undefined,
      );
      for (const c of blockClaims) {
        claims.push({
          ...c,
          id: `claim-${claims.length + 1}-${c.from}`,
        });
      }
    }
    currentBlockText = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = currentOffset;
    currentOffset += line.length + 1; // +1 for the newline

    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushBlock();
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Skip bibliography block or references section
    if (
      /^#+\s*references/i.test(trimmed) ||
      /^#+\s*bibliography/i.test(trimmed) ||
      trimmed.startsWith("<!-- beeblio:bibliography")
    ) {
      flushBlock();
      inBibliographySection = true;
      continue;
    }
    if (inBibliographySection) {
      if (
        /^#\s+[A-Za-z]/.test(trimmed) &&
        !/references|bibliography/i.test(trimmed)
      ) {
        inBibliographySection = false;
      } else {
        continue;
      }
    }

    // Skip empty lines or headers
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("> ")) {
      if (trimmed.startsWith("#") && !/references|bibliography/i.test(trimmed)) {
        currentHeading = trimmed.replace(/^#+\s*/, "").trim();
      }
      flushBlock();
      continue;
    }

    if (!currentBlockText) {
      currentBlockStart = lineStart;
      currentBlockText = line;
    } else {
      currentBlockText += "\n" + line;
    }
  }

  flushBlock();
  return claims;
}
