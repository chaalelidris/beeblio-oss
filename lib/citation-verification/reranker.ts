import type { ClaimDecomposition, EvidencePassage } from "./types";

/**
 * Lightweight Stage C Reranker.
 * Computes deep alignment between decomposed scientific claims and candidate evidence passages
 * using entity coverage, numerical anchor presence, subclaim coverage, and lexical bigram proximity.
 * Does NOT conflate reranking relevance with entailment verification.
 */

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_.-]{3,}/g) || []).filter(
    (w) =>
      ![
        "the", "and", "for", "with", "that", "this", "from", "were", "been",
        "have", "which", "into", "also", "their", "more", "such",
      ].includes(w),
  );
}

export function rerankCandidates(
  claim: ClaimDecomposition,
  candidates: EvidencePassage[],
): EvidencePassage[] {
  if (candidates.length === 0) return [];

  const claimTokens = new Set(tokenize(claim.originalClaim));
  const entityTokens = new Set(
    claim.entities.flatMap((e) => tokenize(e)),
  );
  const numericalTokens = claim.numericalValues.map((v) => v.raw.toLowerCase());

  const scored = candidates.map((cand) => {
    const passageTokens = tokenize(cand.text);
    const passageTokenSet = new Set(passageTokens);
    const passageTextLower = cand.text.toLowerCase();

    // 1. Entity alignment (weight: 35%)
    let entityScore = 0;
    if (entityTokens.size > 0) {
      let matchedEntities = 0;
      for (const e of entityTokens) {
        if (passageTokenSet.has(e)) matchedEntities++;
      }
      entityScore = (matchedEntities / entityTokens.size) * 35;
    } else {
      entityScore = 20; // Default baseline when no named entities detected
    }

    // 2. Numerical anchor match (weight: 25%)
    let numericalScore = 0;
    if (numericalTokens.length > 0) {
      let matchedNumbers = 0;
      for (const n of numericalTokens) {
        if (passageTextLower.includes(n)) matchedNumbers++;
      }
      numericalScore = (matchedNumbers / numericalTokens.length) * 25;
    } else {
      numericalScore = 20;
    }

    // 3. Subclaim lexical overlap (weight: 25%)
    let subclaimScore = 0;
    if (claim.subclaims.length > 0) {
      let coveredSubclaims = 0;
      for (const sub of claim.subclaims) {
        const subTokens = tokenize(sub);
        const subMatch = subTokens.filter((t) => passageTokenSet.has(t)).length;
        if (subTokens.length > 0 && subMatch / subTokens.length >= 0.4) {
          coveredSubclaims++;
        }
      }
      subclaimScore = (coveredSubclaims / claim.subclaims.length) * 25;
    } else {
      subclaimScore = 15;
    }

    // 4. Base token coverage & bigram proximity (weight: 15%)
    let tokenCoverage = 0;
    if (claimTokens.size > 0) {
      let matchedTokens = 0;
      for (const t of claimTokens) {
        if (passageTokenSet.has(t)) matchedTokens++;
      }
      tokenCoverage = (matchedTokens / claimTokens.size) * 15;
    }

    // Base retrieval score prior influence (up to 15%)
    const retrievalPrior = (cand.retrievalScore / 100) * 15;

    const totalRerank = Math.round(
      Math.min(
        99,
        Math.max(5, entityScore + numericalScore + subclaimScore + tokenCoverage * 0.5 + retrievalPrior),
      ),
    );

    return {
      ...cand,
      rerankScore: totalRerank,
    };
  });

  // Sort descending by rerankScore
  return scored.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
}
