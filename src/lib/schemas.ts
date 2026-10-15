// Runtime validation for untrusted data: AI output, stored JSON, provider metadata.
import { z } from "zod";
import type { ArtBrief, ReferenceAnalysis } from "./types";

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen: number) =>
  z
    .array(z.string())
    .default([])
    .transform((items) => uniqueClean(items, maxLen).slice(0, maxItems));

/** Trims, drops empties and case-insensitive duplicates, clips each entry. */
export function uniqueClean(items: string[], maxLen = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const value = raw.trim().slice(0, maxLen);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export const prioritySchema = z.enum(["high", "medium", "low"]);

export const referenceCategorySchema = z.object({
  id: text(60).min(1),
  name: text(80).min(1),
  purpose: text(300).default(""),
  searchQueries: list(8, 120),
  priority: prioritySchema,
  enabled: z.boolean().optional(),
});

export const artBriefSchema = z.object({
  originalPrompt: z.string().max(20_000).default(""),
  subject: list(20, 120),
  environment: list(20, 120),
  palette: list(20, 120),
  lighting: list(20, 120),
  mood: list(20, 120),
  composition: list(20, 120),
  cameraAngle: list(20, 120),
  style: list(20, 120),
  materialsOrTextures: list(20, 120),
  exclusions: list(20, 120),
  referenceCategories: z.array(referenceCategorySchema).max(16),
  generatedBy: z.enum(["mock", "basic-parser", "anthropic", "manual"]).optional(),
});

export const referenceAnalysisSchema = z.object({
  summary: text(1000).min(1),
  detectedCategories: list(12, 80),
  palette: list(8, 40).optional(),
  lighting: text(300).optional(),
  composition: text(300).optional(),
  mood: list(8, 60).optional(),
  relevanceExplanation: text(1000).default(""),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function describe(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "invalid data";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/** Validates an unknown value (or JSON string) as an ArtBrief. */
export function parseArtBrief(input: unknown): ParseResult<ArtBrief> {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: "Brief is not valid JSON" };
    }
  }
  const parsed = artBriefSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: describe(parsed.error) };
  const brief = parsed.data as ArtBrief;
  // Ensure category ids are unique so editing and filtering stay unambiguous.
  const seen = new Set<string>();
  brief.referenceCategories = brief.referenceCategories.map((c, i) => {
    let id = c.id;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...c, id };
  });
  return { ok: true, value: brief };
}

export function parseReferenceAnalysis(input: unknown): ParseResult<ReferenceAnalysis> {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: "Analysis is not valid JSON" };
    }
  }
  const parsed = referenceAnalysisSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: describe(parsed.error) };
  const a = parsed.data;
  return {
    ok: true,
    value: {
      ...a,
      lighting: a.lighting || undefined,
      composition: a.composition || undefined,
    },
  };
}

export function emptyBrief(originalPrompt = ""): ArtBrief {
  return {
    originalPrompt,
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
    referenceCategories: [],
  };
}
