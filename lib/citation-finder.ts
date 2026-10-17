import { getAiTaskConfig } from "./local-ai-settings";
import {
  runCitationVerificationPipeline,
  type VerifiedCitationMatch,
  type VerifiedCitationResult,
  type DraftContext,
} from "./citation-verification";

// Export backward-compatible type aliases
export type CitationFindMatch = VerifiedCitationMatch;
export type FindCitationResult = VerifiedCitationResult;

/**
 * Searches the project bibliography, linked PDFs, and indexed knowledge base
 * to find and verify candidate citations for the user's selected text using the
 * multi-stage Evidence-Based Citation Verification Pipeline.
 *
 * Primary requirement: Never automatically approve a citation solely based on
 * embedding or token similarity.
 */
export async function findCitationForSelection(
  userId: string,
  projectSlug: string,
  selectedText: string,
  context?: DraftContext,
): Promise<FindCitationResult> {
  const query = selectedText.trim();
  if (!query) {
    return {
      found: false,
      message: "No text was selected to find citations for.",
    };
  }

  // Retrieve AI credentials if configured
  let aiApiKey: string | undefined;
  let aiModelId: string | undefined;

  try {
    const aiConfig = await getAiTaskConfig("chat");
    if (aiConfig.apiKey && aiConfig.modelId) {
      aiApiKey = aiConfig.apiKey;
      aiModelId = aiConfig.modelId;
    }
  } catch (err) {
    console.warn(
      "[citation-finder] Could not load AI config, running deterministic verification:",
      err,
    );
  }

  return runCitationVerificationPipeline(userId, projectSlug, query, {
    aiApiKey,
    aiModelId,
    context,
  });
}
