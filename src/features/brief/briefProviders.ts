// Brief analysis providers. The Mock provider is the default: free, offline and
// deterministic. The Anthropic provider is paid and goes through the backend, which
// holds the key and enforces every spending guardrail.

import type { Backend } from "../../lib/backend";
import { BackendError } from "../../lib/backend";
import { parseArtBrief, uniqueClean } from "../../lib/schemas";
import type { ArtBrief, BriefFieldKey, UsageRecord } from "../../lib/types";
import { parseBriefText, type ParsedFields } from "./basicParser";
import { BRIEF_FIELDS, mergeFields, planCategories } from "./queryPlanner";

export type ManualFields = Partial<Record<BriefFieldKey, string[]>>;

export interface BriefAnalysisProvider {
  id: "mock" | "anthropic";
  displayName: string;
  /** True when calling this provider can incur API costs. */
  isPaid: boolean;
  analyzeBrief(prompt: string, manual?: ManualFields): Promise<ArtBrief>;
}

function emptyFields(): ParsedFields {
  return {
    subject: [],
    environment: [],
    palette: [],
    lighting: [],
    mood: [],
    composition: [],
    cameraAngle: [],
    style: [],
    materialsOrTextures: [],
    exclusions: [],
  };
}

/** Pure deterministic analysis (no network). Shared by the mock provider and the no-AI path. */
export function analyzeBriefDeterministic(prompt: string, manual: ManualFields = {}): ArtBrief {
  const parsed = prompt.trim() ? parseBriefText(prompt) : emptyFields();
  const fields = mergeFields(parsed, manual);
  if (!fields.subject.length && prompt.trim()) {
    // Unknown vocabulary (or non-English text): use the start of the prompt as-is.
    fields.subject = [prompt.trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 60)];
  }
  return {
    originalPrompt: prompt,
    ...fields,
    referenceCategories: planCategories(fields),
  };
}

export const mockBriefProvider: BriefAnalysisProvider = {
  id: "mock",
  displayName: "Mock AI (free, offline demo)",
  isPaid: false,
  async analyzeBrief(prompt, manual) {
    return { ...analyzeBriefDeterministic(prompt, manual), generatedBy: "mock" };
  },
};

/** Appends manually entered fields so the model sees them as explicit artist choices. */
export function composePromptWithFields(prompt: string, manual: ManualFields = {}): string {
  const lines = BRIEF_FIELDS.filter(({ key }) => manual[key]?.length).map(
    ({ key, label }) => `${label}: ${(manual[key] ?? []).join(", ")}`,
  );
  return lines.length
    ? `${prompt.trim()}\n\nArtist-specified details:\n${lines.join("\n")}`
    : prompt.trim();
}

export type PaidBriefResult = { brief: ArtBrief; usage: UsageRecord };

/**
 * Paid provider. `confirmed` must reflect an explicit user action (button press).
 * The response is validated again here because AI output is untrusted.
 */
export function createAnthropicBriefProvider(
  backend: Backend,
  onUsage?: (usage: UsageRecord) => void,
): BriefAnalysisProvider & {
  analyzeConfirmed(prompt: string, manual?: ManualFields): Promise<PaidBriefResult>;
} {
  async function analyzeConfirmed(
    prompt: string,
    manual: ManualFields = {},
  ): Promise<PaidBriefResult> {
    const output = await backend.anthropicAnalyzeBrief(
      composePromptWithFields(prompt, manual),
      true,
    );
    onUsage?.(output.usage);
    const parsed = parseArtBrief(output.briefJson);
    if (!parsed.ok) {
      throw new BackendError(
        "provider",
        "invalid_response",
        `The AI response could not be used: ${parsed.error}`,
      );
    }
    const brief = parsed.value;
    // Keep the artist's exact wording and manual choices.
    brief.originalPrompt = prompt;
    for (const { key } of BRIEF_FIELDS) {
      if (manual[key]?.length) brief[key] = uniqueClean([...(manual[key] ?? []), ...brief[key]]);
    }
    brief.referenceCategories = brief.referenceCategories.map((c) => ({ ...c, enabled: true }));
    brief.generatedBy = "anthropic";
    return { brief, usage: output.usage };
  }
  return {
    id: "anthropic",
    displayName: "Anthropic API (usage billed separately)",
    isPaid: true,
    analyzeBrief: async (prompt, manual) => (await analyzeConfirmed(prompt, manual)).brief,
    analyzeConfirmed,
  };
}
