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
});
