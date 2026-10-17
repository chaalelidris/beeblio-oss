import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCitationPlacement,
  checkParagraphCitationHygiene,
  bundleCitationKeys,
  extractCitationsFromText,
} from "../lib/citation-placement";

describe("Academic In-Text Citation Placement Engine", () => {
  test("places citation inside sentence before the terminal period when sentence is fully selected", () => {
    const text = "The results reveal a world far more dynamic than the old maps suggested.";
    const claim = "The results reveal a world far more dynamic than the old maps suggested.";

    const result = calculateCitationPlacement(text, claim, text.length, "peano2020");

    assert.equal(
      result.preview,
      "The results reveal a world far more dynamic than the old maps suggested [@peano2020].",
    );
    assert.equal(result.context, "before_terminal_period");
    assert.equal(result.needsLeadingSpace, true);
    assert.equal(result.needsTrailingSpace, false);
  });

  test("places citation before terminal period even when selection omitted the period", () => {
    const text = "The results reveal a world far more dynamic than the old maps suggested.";
    const claim = "The results reveal a world far more dynamic than the old maps suggested";

    const result = calculateCitationPlacement(text, claim, text.length - 1, "peano2020");

    assert.equal(
      result.preview,
      "The results reveal a world far more dynamic than the old maps suggested [@peano2020].",
    );
    assert.equal(result.context, "before_terminal_period");
  });

  test("places citation before clause punctuation in mid-sentence claims", () => {
    const text = "While surface resistance increases, runoff remains unchanged across basins.";
    const claim = "While surface resistance increases,";

    const result = calculateCitationPlacement(text, claim, 35, "peano2020");

    assert.equal(
      result.preview,
      "While surface resistance increases [@peano2020], runoff remains unchanged across basins.",
    );
    assert.equal(result.context, "before_clause_comma");
    assert.equal(result.needsLeadingSpace, true);
    assert.equal(result.needsTrailingSpace, false);
  });

  test("places citation after closing quotation marks and before terminal period", () => {
    const text = 'The authors reported a "critical tipping point in canopy resistance".';
    const claim = 'The authors reported a "critical tipping point in canopy resistance".';

    const result = calculateCitationPlacement(text, claim, text.length, "lenton2019");

    assert.equal(
      result.preview,
      'The authors reported a "critical tipping point in canopy resistance" [@lenton2019].',
    );
    assert.equal(result.context, "before_terminal_period");
  });

  test("places citation after parenthetical detail and before terminal period", () => {
    const text = "Elevated VPD was documented across Mediterranean basins (particularly southern Italy).";
    const claim = "Elevated VPD was documented across Mediterranean basins (particularly southern Italy).";

    const result = calculateCitationPlacement(text, claim, text.length, "peano2020");

    assert.equal(
      result.preview,
      "Elevated VPD was documented across Mediterranean basins (particularly southern Italy) [@peano2020].",
    );
    assert.equal(result.context, "before_terminal_period");
  });

  test("places citation inside parenthetical sentence when the entire sentence is parenthetical", () => {
    const text = "(For example, surface resistance increased up to 50 s/m).";
    const claim = "(For example, surface resistance increased up to 50 s/m).";

    const result = calculateCitationPlacement(text, claim, text.length, "peano2020");

    assert.equal(
      result.preview,
      "(For example, surface resistance increased up to 50 s/m [@peano2020]).",
    );
  });

  test("places citation after LaTeX / inline math expression without corrupting delimiters", () => {
    const text = "Canopy transpiration is directly governed by $r_s$.";
    const claim = "Canopy transpiration is directly governed by $r_s$.";

    const result = calculateCitationPlacement(text, claim, text.length, "peano2020");

    assert.equal(
      result.preview,
      "Canopy transpiration is directly governed by $r_s$ [@peano2020].",
    );
  });

  test("preserves abbreviations like 'et al.' and decimals without premature period splitting", () => {
    const text = "As shown by Peano et al., surface resistance rose by 0.5%.";
    const claim = "As shown by Peano et al., surface resistance rose by 0.5%.";

    const result = calculateCitationPlacement(text, claim, text.length, "peano2020");

    assert.equal(
      result.preview,
      "As shown by Peano et al., surface resistance rose by 0.5% [@peano2020].",
    );
  });

  test("supports multi-citation bundling into standard pandoc syntax", () => {
    const text = "Multiple CMIP6 climate models demonstrate an increase in surface resistance.";
    const claim = "Multiple CMIP6 climate models demonstrate an increase in surface resistance.";

    const result = calculateCitationPlacement(
      text,
      claim,
      text.length,
      ["peano2020", "zelinka2020"],
    );

    assert.equal(
      result.preview,
      "Multiple CMIP6 climate models demonstrate an increase in surface resistance [@peano2020; @zelinka2020].",
    );
  });
});

describe("Paragraph-Level Citation Hygiene & De-Duplication", () => {
  test("extracts citations from pandoc and latex markdown text", () => {
    const text = "Prior work [@peano2020; @zelinka2020] and \\cite{smith2018} reported higher VPD.";
    const keys = extractCitationsFromText(text);

    assert.deepEqual(keys.sort(), ["peano2020", "smith2018", "zelinka2020"]);
  });

  test("flags redundant citation when same paper is cited in paragraph for general claim", () => {
    const paragraph = "Climate change increases atmospheric vapor pressure deficit [@peano2020]. This elevates surface resistance across temperate forests.";
    const claim = "This elevates surface resistance across temperate forests.";

    const hygiene = checkParagraphCitationHygiene(paragraph, "peano2020", [], claim);

    assert.equal(hygiene.isDuplicated, true);
    assert.equal(hygiene.isExemptStatistic, false);
    assert.match(hygiene.guidance || "", /already cited in this paragraph/i);
  });

  test("allows proximate citation when duplicate paper supports a specific quantitative statistic", () => {
    const paragraph = "Climate change increases atmospheric vapor pressure deficit [@peano2020]. Resistance climbed to 40 to 50 s m-1.";
    const claim = "Resistance climbed to 40 to 50 s m-1.";

    const hygiene = checkParagraphCitationHygiene(paragraph, "peano2020", [], claim);

    assert.equal(hygiene.isDuplicated, true);
    assert.equal(hygiene.isExemptStatistic, true);
    assert.match(hygiene.guidance || "", /specific quantitative measurement/i);
  });

  test("correctly bundles citation keys without duplication", () => {
    const bundled1 = bundleCitationKeys("peano2020", "zelinka2020");
    assert.equal(bundled1, "peano2020; zelinka2020");

    const bundled2 = bundleCitationKeys("peano2020; zelinka2020", "peano2020");
    assert.equal(bundled2, "peano2020; zelinka2020");
  });
});
