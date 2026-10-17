import path from "node:path";
import { parseBibtexEntries } from "../bibtex";
import { referenceFromEntry, type CitationReference } from "../citations";
import {
  PROJECT_BIBLIOGRAPHY_PATH,
  REFERENCES_DIRECTORY,
} from "../project-bibliography";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  WorkspaceFileError,
} from "../workspace-files";
import { searchProjectKnowledge } from "../knowledge";
import type { EvidencePassage, DraftContext, ClaimDecomposition } from "./types";
import { extractScientificClaim } from "./claim-extractor";
import {
  SCIENTIFIC_SYNONYM_MAP,
  checkPolarity,
  checkNumericalConsistency,
} from "./consistency-checker";

type CachedPdfDoc = {
  pages: Array<{ pageNumber: number; paragraphs: string[] }>;
};
const pdfExtractionCache = new Map<string, CachedPdfDoc>();

export function getCachedPdfDocument(targetPdfPath: string): CachedPdfDoc | undefined {
  return pdfExtractionCache.get(targetPdfPath);
}

/**
 * Detects whether a retrieved passage is citing prior literature rather than
 * presenting an original finding (secondary citation detection).
 */
export function detectSecondaryCitation(text: string): { isSecondary: boolean; ref?: string } {
  const bracketCite = text.match(
    /\b(?:(?:according to|as (?:shown|demonstrated|reported|described|modeled|simulated|fixed|standardized) by|following|conventional)\s+[a-zA-Z\s–-]+)?\[(\d+|[A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*\d{4})\]/i,
  );
  if (bracketCite) {
    return { isSecondary: true, ref: bracketCite[0] };
  }
  const parenCite = text.match(
    /\((?:see\s+)?([A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*(?:19|20)\d{2}[a-z]?)\)/,
  );
  if (parenCite) {
    return { isSecondary: true, ref: parenCite[1] };
  }
  return { isSecondary: false };
}

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
  "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves", "also", "across", "including", "may",
]);

export function extractRetrievalTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/\b[a-z0-9_.-]{3,}\b/g) || [];
  return [...new Set(matches.filter((w) => !STOPWORDS.has(w)))];
}

export function cleanPassageText(raw: string): string {
  return raw
    .replace(/(\b\w+)-\s+(\w+\b)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes retrieval recall score based on token coverage and phrase match.
 * High recall oriented: does not judge semantic truth.
 */
export function computePassageRetrievalScore(
  text: string,
  query: string,
  queryTokens: string[],
): {
  score: number;
  matchedTokens: string[];
} {
  const clean = cleanPassageText(text);
  const words = clean.toLowerCase().match(/\b[a-z0-9_.-]{3,}\b/g) || [];
  const tokenSet = new Set(queryTokens);
  const matched = words.filter((w) => tokenSet.has(w));
  const uniqueMatched = [...new Set(matched)];

  const tokenCoverage =
    queryTokens.length > 0 ? uniqueMatched.length / queryTokens.length : 0;

  // Check 2-word phrase overlap
  const cleanQueryLower = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const cleanTextLower = clean.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const queryPhrases = cleanQueryLower.split(/\s+/).filter((w) => w.length > 3);
  let hasPhraseOverlap = false;
  for (let i = 0; i < queryPhrases.length - 1; i++) {
    const bigram = `${queryPhrases[i]} ${queryPhrases[i + 1]}`;
    if (cleanTextLower.includes(bigram)) {
      hasPhraseOverlap = true;
      break;
    }
  }

  const base =
    tokenCoverage * 60 +
    (hasPhraseOverlap ? 25 : 0) +
    Math.min(15, uniqueMatched.length * 2);

  return {
    score: Math.max(10, Math.min(99, Math.round(base))),
    matchedTokens: uniqueMatched,
  };
}

/**
 * Stage B: Evidence Passage Retrieval
 * Maximizes recall by searching individual passages, abstracts, and PDF sections
 * while strictly recording provenance, page numbers, and context.
 */
export async function retrieveCandidateEvidence(
  userId: string,
  projectSlug: string,
  claimText: string,
  options?: { maxCandidates?: number; context?: DraftContext },
): Promise<{
  passages: EvidencePassage[];
  referenceMap: Map<string, CitationReference>;
}> {
  const maxCandidates = options?.maxCandidates ?? 10;
  const cleanQuery = claimText.trim();
  const directTokens = extractRetrievalTokens(cleanQuery);
  const contextTokens = options?.context?.precedingText
    ? extractRetrievalTokens(options.context.precedingText).slice(0, 5)
    : [];
  const headingTokens = options?.context?.sectionHeading
    ? extractRetrievalTokens(options.context.sectionHeading).slice(0, 3)
    : [];
  const queryTokens = [...new Set([...directTokens, ...contextTokens, ...headingTokens])];

  // 1. Read project references.bib
  let bibSource = "";
  try {
    const { content } = await readWorkspaceFile(
      userId,
      projectSlug,
      PROJECT_BIBLIOGRAPHY_PATH,
    );
    bibSource = content.toString("utf8");
  } catch (error) {
    if (error instanceof WorkspaceFileError && error.status === 404) {
      return { passages: [], referenceMap: new Map() };
    }
    throw error;
  }

  const entries = parseBibtexEntries(bibSource);
  if (entries.length === 0) {
    return { passages: [], referenceMap: new Map() };
  }

  const referenceMap = new Map<string, CitationReference>();
  for (const entry of entries) {
    referenceMap.set(entry.key, referenceFromEntry(entry));
  }

  const passages: EvidencePassage[] = [];

  // 2. Extract from abstracts
  for (const entry of entries) {
    const ref = referenceMap.get(entry.key)!;
    const abstract = entry.fields.abstract?.trim();
    if (abstract) {
      const cleanAbstract = cleanPassageText(abstract);
      // Split abstract into sentences / coherent chunks
      const sentences = cleanAbstract
        .split(/(?<=[.?!])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 25);

      for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        const sentence = sentences[sIdx];
        const scored = computePassageRetrievalScore(
          sentence,
          cleanQuery,
          queryTokens,
        );

        if (scored.matchedTokens.length >= 2 || scored.score >= 30) {
          const prevSent = sIdx > 0 ? sentences[sIdx - 1] : "";
          const nextSent =
            sIdx < sentences.length - 1 ? sentences[sIdx + 1] : "";
          const context = [prevSent, sentence, nextSent]
            .filter(Boolean)
            .join(" ");

          passages.push({
            id: `abs_${entry.key}_${sIdx}`,
            citationKey: entry.key,
            reference: ref,
            text: sentence,
            neighboringContext: context !== sentence ? context : undefined,
            sourceLocation: "Abstract",
            sourceFilePath: PROJECT_BIBLIOGRAPHY_PATH,
            sourceFileName: "references.bib",
            doi: entry.fields.doi,
            retrievalScore: scored.score,
            fullSourceAvailable: true,
            fullSourceText: cleanAbstract,
          });
        }
      }

      // Also evaluate whole abstract if no fine-grained sentence met threshold
      const wholeScored = computePassageRetrievalScore(
        cleanAbstract,
        cleanQuery,
        queryTokens,
      );
      if (wholeScored.matchedTokens.length >= 2) {
        passages.push({
          id: `abs_${entry.key}_full`,
          citationKey: entry.key,
          reference: ref,
          text: cleanAbstract,
          sourceLocation: "Abstract",
          sourceFilePath: PROJECT_BIBLIOGRAPHY_PATH,
          sourceFileName: "references.bib",
          doi: entry.fields.doi,
          retrievalScore: wholeScored.score,
          fullSourceAvailable: true,
          fullSourceText: cleanAbstract,
        });
      }
    }
  }

  // 3. Scan linked PDF files in 1-References/
  let refFiles: { name: string; path: string }[] = [];
  try {
    refFiles = await listWorkspaceFiles(
      userId,
      projectSlug,
      REFERENCES_DIRECTORY,
    );
  } catch {
    refFiles = [];
  }

  for (const entry of entries) {
    const ref = referenceMap.get(entry.key)!;
    let targetPdfPath: string | null = null;
    const rawFile = entry.fields.file || "";
    if (rawFile) {
      const firstPart = rawFile.split(":")[0]?.trim() || "";
      if (firstPart.toLowerCase().endsWith(".pdf")) {
        targetPdfPath = firstPart;
      }
    }

    if (!targetPdfPath) {
      const match = refFiles.find(
        (f) =>
          f.name.toLowerCase().endsWith(".pdf") &&
          (f.name.toLowerCase().includes(entry.key.toLowerCase().slice(0, 20)) ||
            entry.key
              .toLowerCase()
              .includes(f.name.toLowerCase().replace(/\.pdf$/, ""))),
      );
      if (match) targetPdfPath = match.path;
    }

    if (targetPdfPath) {
      try {
        let cachedDoc = pdfExtractionCache.get(targetPdfPath);

        if (!cachedDoc) {
          const { content } = await readWorkspaceFile(
            userId,
            projectSlug,
            targetPdfPath,
          );
          await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
          const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(content),
            useSystemFonts: true,
            useWorkerFetch: false,
          });

          try {
            const doc = await loadingTask.promise;
            const maxPages = Math.min(doc.numPages, 30);
            const pages: Array<{ pageNumber: number; paragraphs: string[] }> = [];

            for (let p = 1; p <= maxPages; p++) {
              const page = await doc.getPage(p);
              const pageContent = await page.getTextContent();
              const pageText = cleanPassageText(
                pageContent.items.map((item: any) => item.str ?? "").join(" "),
              );
              if (!pageText || pageText.length < 40) continue;

              const paragraphs = pageText
                .split(/(?:\.\s{2,}|\b(?=[A-Z][a-z]{2,}\s+[a-z]+))/)
                .filter((para) => para.trim().length > 40);

              pages.push({ pageNumber: p, paragraphs });
            }
            cachedDoc = { pages };
            pdfExtractionCache.set(targetPdfPath, cachedDoc);
          } finally {
            await loadingTask.destroy().catch(() => undefined);
          }
        }

        // Process cached pages against query tokens
        for (const page of cachedDoc.pages) {
          const { pageNumber: p, paragraphs } = page;
          for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
            const para = paragraphs[paraIdx].trim();
            const scored = computePassageRetrievalScore(
              para,
              cleanQuery,
              queryTokens,
            );

            if (scored.matchedTokens.length >= 2 || scored.score >= 35) {
              const prevPara = paraIdx > 0 ? paragraphs[paraIdx - 1].trim() : "";
              const nextPara =
                paraIdx < paragraphs.length - 1
                  ? paragraphs[paraIdx + 1].trim()
                  : "";
              const context = [prevPara, para, nextPara]
                .filter(Boolean)
                .join("\n\n");

              const secondary = detectSecondaryCitation(para);

              passages.push({
                id: `pdf_${entry.key}_p${p}_${paraIdx}`,
                citationKey: entry.key,
                reference: ref,
                text: para,
                neighboringContext: context !== para ? context : undefined,
                sourceLocation: `Page ${p}`,
                sourceFilePath: targetPdfPath,
                sourceFileName: path.posix.basename(targetPdfPath),
                pageNumber: p,
                doi: entry.fields.doi,
                retrievalScore: scored.score,
                isSecondaryCitation: secondary.isSecondary,
                secondaryCitationRef: secondary.ref,
                fullSourceAvailable: true,
                fullSourcePages: cachedDoc.pages.map((pg) => ({
                  pageNumber: pg.pageNumber,
                  paragraphs: pg.paragraphs,
                  text: pg.paragraphs.join("\n\n"),
                })),
              });
            }
          }
        }
      } catch (err) {
        console.warn(
          `[citation-verification/retrieval] Could not read PDF for ${entry.key}:`,
          err,
        );
      }
    }
  }

  // 4. Check Knowledge store citations if available
  try {
    const knowledgeResult = await searchProjectKnowledge(
      userId,
      projectSlug,
      cleanQuery,
      { topK: 5 },
    );
    if (knowledgeResult?.result?.citations) {
      for (const citation of knowledgeResult.result.citations) {
        if (
          citation.citationKey &&
          referenceMap.has(citation.citationKey) &&
          citation.excerpt
        ) {
          const ref = referenceMap.get(citation.citationKey)!;
          const cleanExcerpt = cleanPassageText(citation.excerpt);
          const scored = computePassageRetrievalScore(
            cleanExcerpt,
            cleanQuery,
            queryTokens,
          );

          passages.push({
            id: `kn_${citation.citationKey}_${passages.length}`,
            citationKey: citation.citationKey,
            reference: ref,
            text: cleanExcerpt,
            sourceLocation: citation.pageNumber
              ? `Page ${citation.pageNumber}`
              : "Knowledge File",
            sourceFilePath: citation.filePath,
            sourceFileName: citation.fileName,
            pageNumber: citation.pageNumber,
            doi: ref.doi,
            retrievalScore: scored.score,
          });
        }
      }
    }
  } catch {
    // Knowledge store optional
  }

  // Deduplicate candidate passages by citationKey + sourceLocation + text prefix
  const dedupMap = new Map<string, EvidencePassage>();
  for (const p of passages) {
    const key = `${p.citationKey}:::${p.sourceLocation}:::${p.text.slice(0, 40)}`;
    const existing = dedupMap.get(key);
    if (!existing || p.retrievalScore > existing.retrievalScore) {
      dedupMap.set(key, p);
    }
  }

  const sorted = [...dedupMap.values()].sort(
    (a, b) => b.retrievalScore - a.retrievalScore,
  );

  return {
    passages: sorted.slice(0, maxCandidates),
    referenceMap,
  };
}

export type SourceSearchTarget = {
  citationKey?: string;
  reference?: CitationReference;
  pages?: Array<{ pageNumber: number; paragraphs: string[]; text?: string }>;
  fullText?: string;
  paragraphs?: string[];
  neighboringContext?: string;
  sourceFilePath?: string;
};

export type SourceEvidenceSearchResult = {
  found: boolean;
  exactQuote: string;
  passageText: string;
  pageNumber?: number;
  sourceLocation: string;
  neighboringContext?: string;
  score: number;
};

/**
 * Searches the full accessible source document (pages, sections, paragraphs, surrounding context)
 * for a specific claim.
 *
 * Ensures that a single retrieved excerpt is never treated as the complete evidence
 * available in a document.
 */
export function searchSourceForEvidence(
  source: SourceSearchTarget,
  claimInput: ClaimDecomposition | string,
): SourceEvidenceSearchResult | null {
  const claim: ClaimDecomposition =
    typeof claimInput === "string" ? extractScientificClaim(claimInput) : claimInput;

  type CandidateUnit = {
    sentence: string;
    paragraph: string;
    pageNumber?: number;
    sourceLocation: string;
  };
  const units: CandidateUnit[] = [];

  // 1. Collect from multi-page documents (PDFs)
  if (source.pages && source.pages.length > 0) {
    for (const page of source.pages) {
      const p = page.pageNumber;
      const paras =
        page.paragraphs && page.paragraphs.length > 0
          ? page.paragraphs
          : page.text
            ? page.text.split(/(?:\n\s*\n|\.\s{2,})/).filter((t) => t.trim().length > 25)
            : [];

      for (const rawPara of paras) {
        const para = cleanPassageText(rawPara);
        if (!para || para.length < 20) continue;
        const sentences = para
          .split(/(?<=[.?!])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 20);

        for (const sent of sentences) {
          units.push({
            sentence: sent,
            paragraph: para,
            pageNumber: p,
            sourceLocation: `Page ${p}`,
          });
        }
        units.push({
          sentence: para,
          paragraph: para,
          pageNumber: p,
          sourceLocation: `Page ${p}`,
        });
      }
    }
  }

  // 2. Collect from paragraph list
  if (source.paragraphs && source.paragraphs.length > 0) {
    for (const rawPara of source.paragraphs) {
      const para = cleanPassageText(rawPara);
      if (!para || para.length < 20) continue;
      const sentences = para
        .split(/(?<=[.?!])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      for (const sent of sentences) {
        units.push({
          sentence: sent,
          paragraph: para,
          pageNumber: undefined,
          sourceLocation: "Paragraph",
        });
      }
      units.push({
        sentence: para,
        paragraph: para,
        pageNumber: undefined,
        sourceLocation: "Paragraph",
      });
    }
  }

  // 3. Collect from full text
  if (source.fullText) {
    const paras = source.fullText
      .split(/(?:\n\s*\n|\.\s{2,})/)
      .filter((t) => t.trim().length > 25);
    for (const rawPara of paras) {
      const para = cleanPassageText(rawPara);
      if (!para || para.length < 20) continue;
      const sentences = para
        .split(/(?<=[.?!])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);

      for (const sent of sentences) {
        units.push({
          sentence: sent,
          paragraph: para,
          pageNumber: undefined,
          sourceLocation: "Document",
        });
      }
      units.push({
        sentence: para,
        paragraph: para,
        pageNumber: undefined,
        sourceLocation: "Document",
      });
    }
  }

  // 4. Collect from neighboring context
  if (source.neighboringContext) {
    const para = cleanPassageText(source.neighboringContext);
    const sentences = para
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    for (const sent of sentences) {
      units.push({
        sentence: sent,
        paragraph: para,
        pageNumber: undefined,
        sourceLocation: "Surrounding Context",
      });
    }
    units.push({
      sentence: para,
      paragraph: para,
      pageNumber: undefined,
      sourceLocation: "Surrounding Context",
    });
  }

  if (units.length === 0) return null;

  let bestCandidate: { unit: CandidateUnit; score: number } | null = null;

  for (const unit of units) {
    const textLower = unit.sentence.toLowerCase();
    const paraLower = unit.paragraph.toLowerCase();

    // Directional Polarity validation
    const pol = checkPolarity(claim.originalClaim, unit.sentence);
    if (!pol.matches) continue;

    // Numerical consistency validation
    let numScore = 0;
    if (claim.numericalValues.length > 0) {
      const numCheck = checkNumericalConsistency(claim, unit.paragraph);
      if (
        numCheck.discrepancies.some(
          (d) => d.includes("Numerical mismatch") || d.includes("Unit mismatch"),
        )
      ) {
        // Direct numerical conflict with evidence
        continue;
      }
      if (numCheck.numericalMatch && numCheck.unitMatch) {
        numScore = 40;
      }
    } else {
      numScore = 20;
    }

    // Subclaim coverage validation
    let subMatches = 0;
    for (const sub of claim.subclaims) {
      const words = sub
        .toLowerCase()
        .match(/\b[a-z]{3,}\b/g)
        ?.filter((w) => !STOPWORDS.has(w)) || [];
      if (words.length === 0) continue;
      let matchedCount = 0;
      for (const w of words) {
        if (textLower.includes(w) || paraLower.includes(w)) {
          matchedCount++;
          continue;
        }
        for (const [key, syns] of Object.entries(SCIENTIFIC_SYNONYM_MAP)) {
          if (
            (key.includes(w) || syns.includes(w)) &&
            syns.some((syn) => textLower.includes(syn) || paraLower.includes(syn))
          ) {
            matchedCount++;
            break;
          }
        }
      }
      if (matchedCount / words.length >= 0.5) {
        subMatches++;
      }
    }

    if (subMatches === 0 && claim.subclaims.length > 0) continue;

    const subScore = (subMatches / Math.max(1, claim.subclaims.length)) * 40;

    // Entity alignment
    let entityScore = 0;
    if (claim.entities.length > 0) {
      const matchedEntities = claim.entities.filter(
        (e) => textLower.includes(e.toLowerCase()) || paraLower.includes(e.toLowerCase()),
      );
      entityScore = (matchedEntities.length / claim.entities.length) * 20;
    } else {
      entityScore = 15;
    }

    const totalScore = numScore + subScore + entityScore;
    const lengthPenalty = unit.sentence === unit.paragraph ? 4 : 0;
    const finalScore = totalScore - lengthPenalty;

    if (finalScore >= 55 && (!bestCandidate || finalScore > bestCandidate.score)) {
      bestCandidate = { unit, score: finalScore };
    }
  }

  if (!bestCandidate) return null;

  return {
    found: true,
    exactQuote: bestCandidate.unit.sentence,
    passageText: bestCandidate.unit.paragraph,
    pageNumber: bestCandidate.unit.pageNumber,
    sourceLocation: bestCandidate.unit.sourceLocation,
    neighboringContext: bestCandidate.unit.paragraph,
    score: Math.min(99, Math.round(bestCandidate.score)),
  };
}
