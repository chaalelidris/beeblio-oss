"use server";

import { requireUser } from "@/lib/auth/session";
import { findCitationForSelection, type FindCitationResult } from "@/lib/citation-finder";
import type { DraftContext } from "@/lib/citation-verification";

export async function findCitationForSelectionAction(
  projectId: string,
  selectedText: string,
  context?: DraftContext,
): Promise<FindCitationResult> {
  const user = await requireUser();
  return findCitationForSelection(user.id, projectId, selectedText, context);
}
