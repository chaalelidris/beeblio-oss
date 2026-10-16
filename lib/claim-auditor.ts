/**
 * Uncited Claim Auditor with Q1 Journal Paper Best Practices:
 * 1. Cite every claim that requires external evidence, not necessarily every sentence.
 * 2. If an entire paragraph summarizes one study, a citation at the end may suffice,
 *    provided it is clear that the source supports all the relevant claims.
 * 3. If you introduce a new source or make a distinct factual claim, cite it near that claim.
 * 4. Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.
 * 5. Avoid placing a single citation at the end of a long paragraph containing claims from several different studies.
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
};

// Citation patterns in Markdown, LaTeX, and academic writing
export const CITATION_PATTERNS = [
  /\[@[a-zA-Z0-9_:.#$%&\-+?<>~/]+(?:\s*;\s*@[a-zA-Z0-9_:.#$%&\-+?<>~/]+)*\]/, // [@key]
  /\\cite[tp]?\*?(?:\[.*?\])?\{[a-zA-Z0-9_:,\s-]+\}/, // \cite{key}
  /\[\d+(?:[–—,-]\s*\d+)*\]/, // [1], [8], [9–18]
  /\([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?,\s*(?:19|20)\d{2}[a-z]?\)/, // (Author et al., 2023)
  /\([A-Z][a-zA-Z]+\s+(?:19|20)\d{2}[a-z]?\)/, // (Author 2023)
];

// Disparate study transitions and comparative markers indicating multiple studies (Rule 5 & Rule 3)
export const DISPARATE_STUDY_TRANSITIONS = [
  /\b(?:in contrast|conversely|on the other hand|another study|other studies|meanwhile|by comparison|alternatively|differing from|whereas|in another work)\b/i,
  /\b(?:earlier work|subsequent research|a separate study|different findings|competing findings)\b/i,
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

export const AUTHOR_MENTION_REGEX = /\b[A-Z][a-zA-Z]+(?:\s+et\s+al\.?|\s+and\s+colleagues|\s+and\s+coworkers|\s+and\s+[A-Z][a-zA-Z]+)/g;

const EMPIRICAL_VERBS = [
  "show", "shows", "showed", "demonstrate", "demonstrates", "demonstrated",
  "found", "finds", "observe", "observed", "observes", "indicate", "indicates", "indicated",
  "reveal", "reveals", "revealed", "confirm", "confirms", "confirmed",
  "suggest", "suggests", "suggested", "report", "reports", "reported",
  "conclude", "concluded", "concludes", "argue", "argues", "argued",
  "propose", "proposes", "proposed", "state", "states", "stated",
  "established", "measured", "estimated", "calculated", "tested", "discovered",
  "reflects", "represents", "exhibits", "encompasses", "requires", "proven",
];

const STATISTICAL_TERMS = [
  "%", "percent", "percentage", "increased", "decreased", "reduction", "growth",
  "rate", "average", "median", "majority", "minority", "statistically", "significant",
  "double", "triple", "fold", "±", "uncertainty", "ratio", "magnitude", "correlation",
  "variance", "trend", "stable", "fluctuation", "drop", "rise", "deficit", "surplus",
];

const LITERATURE_TERMS = [
  "previous studies", "prior work", "earlier research", "literature shows",
  "literature suggests", "conventional wisdom", "traditional models",
  "standard practice", "historically", "documented by", "according to",
  "existing frameworks", "prior models", "past research",
];

const TEMPORAL_EXTENT_TERMS = [
  "over the past", "decades", "centuries", "rarely used", "consistently",
  "historically", "traditionally", "has emerged", "remain", "remains",
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
  if (/\([^)]*(?:19|20)\d{2}[a-z]?\s*;\s*[^)]*(?:19|20)\d{2}[a-z]?\)/.test(text)) return true;
  const bracketMatches = text.match(/\[(?:@[a-zA-Z0-9_:.\-+]+|\d+)\]/g);
  if (bracketMatches && bracketMatches.length >= 2) return true;
  return false;
}

/**
 * Checks if a sentence contains or is immediately followed by a citation.
 */
export function hasCitation(sentenceText: string, contextFollowing = ""): boolean {
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
  if (trimmed.startsWith("#") || trimmed.startsWith("<!--") || trimmed.startsWith("![")) {
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
          "Q1 Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
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
        q1Guideline: "Q1 Best Practice: If you introduce a new source or make a distinct factual claim, cite it near that claim.",
      };
    }
  }

  // 3. Statistical / Quantitative claims
  for (const term of STATISTICAL_TERMS) {
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (regex.test(lower)) {
      return {
        isClaim: true,
        signal: `Contains quantitative assertion ("${term}")`,
        category: "statistic",
        q1Guideline: "Q1 Best Practice: Cite every claim that requires external evidence, not necessarily every sentence.",
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
        q1Guideline: "Q1 Best Practice: Cite every claim that requires external evidence, not necessarily every sentence.",
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
  if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
    try {
      const segmenter = new (Intl as any).Segmenter("en", { granularity: "sentence" });
      const segments = Array.from(segmenter.segment(text)) as { segment: string; index: number }[];
      return segments
        .map((s) => {
          const trimmed = s.segment.trim();
          if (!trimmed) return null;
          const leadingSpace = s.segment.indexOf(trimmed);
          const from = baseOffset + s.index + (leadingSpace >= 0 ? leadingSpace : 0);
          const to = from + trimmed.length;
          const following = text.slice(s.index + s.segment.length);
          return { text: trimmed, from, to, following };
        })
        .filter((s): s is { text: string; from: number; to: number; following: string } => Boolean(s));
    } catch {
      // Fall through to regex-based fallback
    }
  }

  // Fallback regex
  const sentences: { text: string; from: number; to: number; following: string }[] = [];
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
export function auditParagraphClaims(paraText: string, baseOffset = 0): UncitedClaim[] {
  const claims: UncitedClaim[] = [];
  const trimmed = paraText.trim();
  if (trimmed.length < 32) return claims;

  // Skip headers or bibliography blocks
  if (trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith("<!--")) {
    return claims;
  }

  const sentences = extractSentences(paraText, baseOffset);
  if (sentences.length === 0) return claims;

  const totalCitations = countCitations(paraText);
  const lastSentence = sentences[sentences.length - 1];
  const lastSentenceCited = hasCitation(lastSentence.text, lastSentence.following);
  const hasDisparateTransitions = DISPARATE_STUDY_TRANSITIONS.some((r) => r.test(paraText));
  const rawAuthorMatches = paraText.match(AUTHOR_MENTION_REGEX) || [];
  const uniqueAuthors = Array.from(new Set(rawAuthorMatches));
  const hasMultipleStudies = uniqueAuthors.length >= 2 || hasDisparateTransitions;

  // Rule 2: Single-study summary paragraph
  // Entire paragraph summarizes 1 study, terminates with that study's citation,
  // and does not contain contrasting/disparate studies.
  const isSingleStudySummary =
    lastSentenceCited &&
    totalCitations === 1 &&
    !hasMultipleStudies;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const sCited = hasCitation(s.text, s.following);
    const { isClaim, signal, category, requiresMultipleSources, q1Guideline } = detectClaimSignal(s.text);

    // Rule 1: Only claims requiring external evidence are flagged
    if (!isClaim) continue;

    // Rule 4: Consensus / Literature Synthesis claims
    if (category === "consensus") {
      if (sCited) {
        const hasMulti = hasMultipleSources(s.text) || hasMultipleSources(s.following.slice(0, 35));
        if (!hasMulti) {
          claims.push({
            id: `claim-${baseOffset}-${s.from}`,
            text: s.text,
            from: s.from,
            to: s.to,
            signal: `Consensus claim cited with only 1 source`,
            category: "consensus",
            requiresMultipleSources: true,
            q1Guideline: "Q1 Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
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
          q1Guideline: "Q1 Best Practice: Use multiple sources when comparing findings, establishing consensus, or identifying research gaps.",
        });
      }
      continue;
    }

    // Direct citation present on this sentence
    if (sCited) continue;

    // Rule 2 Check: Single-study summary paragraph allows trailing citation
    if (isSingleStudySummary) {
      // The trailing citation at the end covers this study's summary claims.
      continue;
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
        q1Guideline: "Q1 Best Practice: Avoid placing a single citation at the end of a paragraph containing claims from several different studies. Cite each claim near that claim.",
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
      q1Guideline: q1Guideline || "Q1 Best Practice: If you introduce a new source or make a distinct factual claim, cite it near that claim.",
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

  let currentBlockText = "";
  let currentBlockStart = 0;

  const flushBlock = () => {
    if (currentBlockText.trim().length >= 32) {
      const blockClaims = auditParagraphClaims(currentBlockText, currentBlockStart);
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
      if (/^#\s+[A-Za-z]/.test(trimmed) && !/references|bibliography/i.test(trimmed)) {
        inBibliographySection = false;
      } else {
        continue;
      }
    }

    // Skip empty lines or headers
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("> ")) {
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

