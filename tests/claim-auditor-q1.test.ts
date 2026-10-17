import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  auditParagraphClaims,
  auditDocumentClaims,
  hasMultipleSources,
} from "../lib/claim-auditor.ts";

describe("Q1 Journal Paper Citation Rules", () => {
  test("Rule 1: Does not flag non-claim introductory or methodology sentences lacking external claims", () => {
    const text =
      "In this paper, we explore autonomous drone navigation in confined corridors. The sensor suite was calibrated at standard room temperature. Understanding dynamic stability is critical for long-term deployments.";
    const claims = auditParagraphClaims(text);
    assert.equal(claims.length, 0, "Framing, meta, and standard sentences should not be flagged");
  });

  test("Rule 2: Single-study summary paragraph with a trailing citation is exempt from mid-paragraph false positives", () => {
    const text =
      "Smith et al. (2020) investigated the degradation of cathode materials under thermal stress. They tested 150 pouch cells over 800 cycles across varying ambient temperatures. The team recorded a 14% decrease in specific capacity and identified microcracking as the primary failure mode [1].";
    const claims = auditParagraphClaims(text);
    assert.equal(claims.length, 0, "A cohesive single-study summary ending in a citation supports all claims in that paragraph");
  });

  test("Rule 3 & 5: Disparate studies in a single paragraph cannot rely on a single trailing citation", () => {
    const text =
      "Early work by Smith et al. showed that silicon anodes disintegrate rapidly during cycling. In contrast, Johnson et al. observed that silicon-graphene composites retain 85% capacity [2].";
    const claims = auditParagraphClaims(text);
    assert.ok(claims.length >= 1, "Should flag the disparate uncited claim");
    assert.ok(
      claims[0].q1Guideline?.includes("Avoid placing a single citation at the end of a paragraph containing claims from several different studies") ||
      claims[0].q1Guideline?.includes("If you introduce a new source or make a distinct factual claim"),
      "Should include Q1 guideline for proximate citation"
    );
  });

  test("Rule 4: Consensus claims require multiple sources and flag single-source citations", () => {
    // 1 source for a broad consensus assertion
    const singleSourceConsensus =
      "Several studies have demonstrated that graphene enhances the thermal conductivity of epoxy resins [3].";
    const singleClaims = auditParagraphClaims(singleSourceConsensus);
    assert.equal(singleClaims.length, 1, "Should flag consensus claim cited with only 1 source");
    assert.equal(singleClaims[0].requiresMultipleSources, true);
    assert.ok(singleClaims[0].q1Guideline?.includes("Use multiple sources when comparing findings, establishing consensus"));

    // Multi-source citation passes
    const multiSourceConsensus =
      "Several studies have demonstrated that graphene enhances the thermal conductivity of epoxy resins [3, 4, 5].";
    const multiClaims = auditParagraphClaims(multiSourceConsensus);
    assert.equal(multiClaims.length, 0, "Consensus backed by multiple sources should pass");

    // Uncited consensus claim
    const uncitedConsensus =
      "A growing body of literature indicates that polymer degradation accelerates under UV exposure.";
    const uncitedClaims = auditParagraphClaims(uncitedConsensus);
    assert.equal(uncitedClaims.length, 1);
    assert.equal(uncitedClaims[0].requiresMultipleSources, true);
  });

  test("Multi-source citation helpers correctly identify multiple keys, ranges, and semicolons", () => {
    assert.equal(hasMultipleSources("[@smith2020; @doe2021]"), true);
    assert.equal(hasMultipleSources("[1, 2, 3]"), true);
    assert.equal(hasMultipleSources("[1-4]"), true);
    assert.equal(hasMultipleSources("[1–4]"), true);
    assert.equal(hasMultipleSources("(Smith, 2020; Jones, 2021)"), true);
    assert.equal(hasMultipleSources("[1] [2]"), true);

    assert.equal(hasMultipleSources("[@smith2020]"), false);
    assert.equal(hasMultipleSources("[1]"), false);
    assert.equal(hasMultipleSources("(Smith, 2020)"), false);
  });

  test("auditDocumentClaims correctly scopes claims paragraph by paragraph", () => {
    const doc = `
# Introduction

In this paper, we examine high-performance composites.

Smith et al. (2020) investigated cathode degradation under thermal stress. They tested 150 pouch cells over 800 cycles across varying ambient temperatures. The team recorded a 14% decrease in specific capacity [1].

Several studies have demonstrated that graphene enhances thermal conductivity [2].
`;
    const claims = auditDocumentClaims(doc);
    assert.equal(claims.length, 1, "Only the single-sourced consensus claim should be flagged");
    assert.equal(claims[0].category, "consensus");
    assert.equal(claims[0].requiresMultipleSources, true);
  });

  test("Academic Writing: distinguishes specific statistic claims from general study findings", () => {
    // Specific statistic or technical finding requiring proximate citation
    const statText1 = "Pressure reduction improved by 15% across all tested flow rates.";
    const statText2 = "Global mean anomalies reached approximately 40–50 s m^(-1) by century end.";
    const generalText = "During the historical period, low surface resistance was observed in densely vegetated areas.";

    const claims1 = auditParagraphClaims(statText1);
    assert.ok(claims1.length >= 1, "Specific percentage finding must be detected as claim");

    const claims2 = auditParagraphClaims(statText2);
    assert.ok(claims2.length >= 1, "Quantitative interval anomaly must be detected as claim");

    const generalClaims = auditParagraphClaims(generalText);
    assert.ok(generalClaims.length >= 1, "General empirical sentence without citation is flagged when paragraph has no citation");

    // Ordinary within-paper contrast does not trigger disparate study flag
    const singleStudyContrastingPara =
      "Low surface resistance was observed in arid regions. In contrast, higher resistance values were predominantly found in humid zones. These patterns are consistent with land-atmosphere feedback models [1].";
    const contrastClaims = auditParagraphClaims(singleStudyContrastingPara);
    assert.equal(contrastClaims.length, 0, "Ordinary within-paper contrast in a single cited study should not trigger duplicate citation requirements");
  });
});
