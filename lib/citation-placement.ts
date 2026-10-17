import { isSpecificStatisticClaim } from "./claim-auditor";
import { citationKeys } from "./citations";

export type CitationPlacementResult = {
  /** The adjusted character index inside the target paragraph where the citation should be inserted */
  insertIndex: number;
  /** Whether a leading space is required before the citation token */
  needsLeadingSpace: boolean;
  /** Whether a trailing space is required after the citation token */
  needsTrailingSpace: boolean;
  /** Academic context identified for the placement */
  context:
    | "before_terminal_period"
    | "before_clause_comma"
    | "before_semicolon"
    | "before_colon"
    | "after_quote_before_period"
    | "after_parenthesis_before_period"
    | "inside_parentheses"
    | "adjacent_citation"
    | "clause_end"
    | "block_end";
  /** Live formatted preview of the sentence with the citation inserted */
  preview: string;
};

/**
 * Extracts all unique citation keys referenced in a markdown or prose text snippet.
 * Supports:
 * - `[@key]`
 * - `[@key1; @key2]`
 * - `\cite{key1, key2}`
 * - raw `@key` mentions
 */
export function extractCitationsFromText(text: string): string[] {
  if (!text) return [];
  const keys = new Set<string>();

  // 1. Standard Pandoc / Markdown [@key] or [@key1; @key2]
  const pandocMatches = text.matchAll(/\[@([A-Za-z0-9_:.-]+(?:\s*;\s*@[A-Za-z0-9_:.-]+)*)\]/g);
  for (const m of pandocMatches) {
    const raw = m[1];
    citationKeys(raw).forEach((k) => keys.add(k));
  }

  // 2. LaTeX \cite{key1, key2}
  const latexMatches = text.matchAll(/\\cite[tp]?\*?(?:\[.*?\])?\{([a-zA-Z0-9_:,\s-]+)\}/g);
  for (const m of latexMatches) {
    m[1].split(",").forEach((k) => {
      const clean = k.trim();
      if (clean) keys.add(clean);
    });
  }

  return Array.from(keys);
}

/**
 * Checks whether a citation key is already cited within the same paragraph.
 * In academic publishing (Q1 journals, APA, IEEE, Nature), repeating the exact same
 * citation within a single paragraph is considered redundant over-citation unless
 * citing a specific technical measurement or contrasting quantitative finding.
 */
export function checkParagraphCitationHygiene(
  paragraphText: string,
  candidateCitationKey: string,
  existingBlockKeys: string[] = [],
  claimText?: string,
): {
  isDuplicated: boolean;
  isExemptStatistic: boolean;
  existingKeys: string[];
  guidance?: string;
} {
  const normKey = candidateCitationKey.replace(/^@/, "").trim().toLowerCase();
  const textKeys = extractCitationsFromText(paragraphText).map((k) => k.toLowerCase());
  const blockKeys = existingBlockKeys.map((k) => k.replace(/^@/, "").trim().toLowerCase());

  const allExisting = Array.from(new Set([...textKeys, ...blockKeys]));
  const isDuplicated = allExisting.includes(normKey);

  const isExemptStatistic = Boolean(claimText && isSpecificStatisticClaim(claimText));

  let guidance: string | undefined;
  if (isDuplicated) {
    if (isExemptStatistic) {
      guidance = `Note: @${candidateCitationKey} is already cited in this paragraph, but proximate citation is permissible because this sentence reports a specific quantitative measurement.`;
    } else {
      guidance = `Academic Best Practice: @${candidateCitationKey} is already cited in this paragraph. Citing the same source multiple times in one paragraph is redundant unless distinguishing separate empirical findings.`;
    }
  }

  return {
    isDuplicated,
    isExemptStatistic,
    existingKeys: allExisting,
    guidance,
  };
}

/**
 * Combines two citation keys into a standard pandoc multi-citation key format.
 * e.g., ("peano2020", "zelinka2020") => "peano2020; zelinka2020"
 */
export function bundleCitationKeys(existingId: string, newKey: string): string {
  const existing = citationKeys(existingId);
  const cleanNew = newKey.replace(/^@/, "").trim();
  if (existing.includes(cleanNew)) return existingId;
  return [...existing, cleanNew].join("; ");
}

/**
 * Computes the publication-grade in-text placement position for a citation.
 *
 * Academic Standards Enforced:
 * 1. Terminal Punctuation: Parenthetical citations belong INSIDE the sentence,
 *    immediately preceding the terminal period, question mark, or exclamation mark:
 *    `"...dynamic than the old maps suggested [@peano2020]."`
 *    (NEVER after the period: `"...suggested. [@peano2020]"`).
 * 2. Clause Punctuation: Citations for specific mid-sentence clauses or statistics
 *    must precede the comma or semicolon:
 *    `"While surface resistance increases [@peano2020], runoff remains..."`
 * 3. Quotations: When citing a direct quote, citation follows the closing quote
 *    and precedes the terminal period:
 *    `"“tipping point” [@lenton2019]."`
 * 4. Parentheses: If the sentence ends with a parenthetical clause, the citation
 *    attaches after the parenthesis and before the period:
 *    `"...in Europe (specifically Italy) [@peano2020]."`
 *    If the whole sentence is parenthetical, it attaches before the closing parenthesis:
 *    `"(e.g., surface resistance of 50 s/m [@peano2020])."`
 * 5. Formatting Protection: Citations never split words, LaTeX formulas (`$r_s$`),
 *    or markdown formatting (`**bold**`, `*italic*`, `[text](url)`).
 */
export function calculateCitationPlacement(
  paragraphText: string,
  claimText: string,
  preferredEndIndex?: number,
  citationKeysToInsert: string | string[] = "citationKey",
): CitationPlacementResult {
  const keysArray = Array.isArray(citationKeysToInsert)
    ? citationKeysToInsert
    : citationKeys(citationKeysToInsert);
  const citationToken =
    keysArray.length > 1
      ? `[@${keysArray.join("; @")}]`
      : `[@${keysArray[0] || "citationKey"}]`;

  const textLen = paragraphText.length;
  let targetIndex = preferredEndIndex ?? textLen;

  // If claim text is provided and found in the paragraph, locate its end boundary
  const trimmedClaim = claimText.trim();
  if (trimmedClaim.length > 0) {
    const claimIdx = paragraphText.indexOf(trimmedClaim);
    if (claimIdx >= 0) {
      targetIndex = claimIdx + trimmedClaim.length;
    }
  }

  // Bound index within paragraph length
  targetIndex = Math.max(0, Math.min(targetIndex, textLen));

  // Step 1: Detect if targetIndex landed after a terminal period / punctuation
  // e.g. User selected the entire sentence including the trailing "."
  // We must step back BEFORE the punctuation!
  let charAtTargetMinusOne = targetIndex > 0 ? paragraphText[targetIndex - 1] : "";
  let walkedBackPunct = false;
  let punctChar = "";

  // Check if targetIndex was right after terminal punctuation
  if (/[.?!,;:]/.test(charAtTargetMinusOne)) {
    // Check if it's an abbreviation like "et al." or "e.g." or a decimal like "0.5"
    const isAbbreviationOrDecimal =
      /(?:et al|i\.e|e\.g|vs|cf|\b[A-Z]|\d)\.$/i.test(paragraphText.slice(0, targetIndex));

    if (!isAbbreviationOrDecimal) {
      punctChar = charAtTargetMinusOne;
      targetIndex--;
      walkedBackPunct = true;
    }
  }

  // Step 2: If targetIndex is preceded by whitespace, trim backwards
  while (targetIndex > 0 && /\s/.test(paragraphText[targetIndex - 1])) {
    targetIndex--;
  }

  // Step 3: Handle closing quotes and parentheses
  // If targetIndex is right before a closing quote, check if we should place after the quote:
  // e.g. "novel approach" -> should place after the quote: "novel approach" [@key].
  if (targetIndex < textLen && /[”"']/.test(paragraphText[targetIndex])) {
    targetIndex++; // advance past closing quote
  } else if (targetIndex > 0 && /[”"']/.test(paragraphText[targetIndex - 1])) {
    // already after closing quote
  }

  // If sentence ends with parenthetical remark: "...in Europe (southern Italy)."
  // vs entire sentence being parenthetical: "(For example, resistance increased up to 50 s/m)."
  const beforeTarget = paragraphText.slice(0, targetIndex);
  const lastOpenParen = beforeTarget.lastIndexOf("(");
  const isEntireSentenceParenthetical =
    lastOpenParen >= 0 &&
    (lastOpenParen === 0 || /^[.?!]\s*$/i.test(beforeTarget.slice(0, lastOpenParen).trim()));

  if (targetIndex < textLen && paragraphText[targetIndex] === ")") {
    if (!isEntireSentenceParenthetical) {
      // Clause parenthetical: Step past the closing parenthesis so citation is: `(southern Italy) [@key].`
      targetIndex++;
    }
  } else if (targetIndex > 0 && paragraphText[targetIndex - 1] === ")") {
    if (isEntireSentenceParenthetical) {
      // Whole sentence parenthetical: Step back before `)` so citation is inside: `(claim [@key]).`
      targetIndex--;
    }
  }

  // Step 5: Advance past math delimiters if cursor landed inside inline math $...$
  const textBefore = paragraphText.slice(0, targetIndex);
  const dollarCount = (textBefore.match(/(?<!\\)\$/g) || []).length;
  if (dollarCount % 2 === 1) {
    // Inside unclosed math block, find closing $
    const closeDollar = paragraphText.indexOf("$", targetIndex);
    if (closeDollar >= 0) {
      targetIndex = closeDollar + 1;
    }
  }

  // Step 6: Avoid splitting words or markdown tokens
  // If targetIndex lands inside a word character, advance to the end of the word
  while (targetIndex < textLen && /[\p{L}\p{N}\-_]/u.test(paragraphText[targetIndex])) {
    targetIndex++;
  }

  // Step 7: Check if targetIndex is preceded by an existing citation node or text:
  // e.g. `[@peano2020]`
  const beforeTargetTrimmed = paragraphText.slice(0, targetIndex).trimEnd();
  const isAdjacentToExistingCitation = /\[@[^\]]+\]$/.test(beforeTargetTrimmed);

  // Step 8: Determine academic context
  let context: CitationPlacementResult["context"] = "before_terminal_period";
  const remainingText = paragraphText.slice(targetIndex);

  if (isAdjacentToExistingCitation) {
    context = "adjacent_citation";
  } else if (/^[.?!]/.test(remainingText) || walkedBackPunct && /[.?!]/.test(punctChar)) {
    context = "before_terminal_period";
  } else if (/^[,;:]/.test(remainingText) || walkedBackPunct && /[,]/.test(punctChar)) {
    context = "before_clause_comma";
  } else if (/^[;]/.test(remainingText) || walkedBackPunct && /[;]/.test(punctChar)) {
    context = "before_semicolon";
  } else if (targetIndex >= textLen) {
    context = "block_end";
  } else {
    context = "clause_end";
  }

  // Step 9: Determine whitespace rules
  // A citation always requires a leading space if preceding character is not whitespace or '('
  const prevChar = targetIndex > 0 ? paragraphText[targetIndex - 1] : "";
  const needsLeadingSpace = prevChar.length > 0 && !/\s/.test(prevChar) && prevChar !== "(";

  // A citation does NOT have trailing space if followed immediately by punctuation (. , ; : ! ? ) ])
  const nextChar = targetIndex < textLen ? paragraphText[targetIndex] : "";
  const nextIsPunctuation = /[.,;:?!)\],"'”’]/.test(nextChar);
  const needsTrailingSpace = nextChar.length > 0 && !/\s/.test(nextChar) && !nextIsPunctuation;

  // Step 10: Generate live formatted preview
  const lead = needsLeadingSpace ? " " : "";
  const trail = needsTrailingSpace ? " " : "";
  const preview = `${paragraphText.slice(0, targetIndex)}${lead}${citationToken}${trail}${paragraphText.slice(targetIndex)}`;

  return {
    insertIndex: targetIndex,
    needsLeadingSpace,
    needsTrailingSpace,
    context,
    preview,
  };
}
