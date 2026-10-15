// Turns structured brief fields into reference categories with concise image-search
// queries. Deterministic: the same fields always produce the same plan.

import { uniqueClean } from "../../lib/schemas";
import type { ArtBrief, BriefFieldKey, Priority, ReferenceCategory } from "../../lib/types";
import type { ParsedFields } from "./basicParser";

export const BRIEF_FIELDS: { key: BriefFieldKey; label: string; hint: string }[] = [
  { key: "subject", label: "Subject", hint: "e.g. red fox, armored knight" },
  { key: "environment", label: "Environment", hint: "e.g. bamboo forest, night market" },
  { key: "palette", label: "Palette", hint: "e.g. teal, orange, muted" },
  { key: "mood", label: "Mood", hint: "e.g. serene, eerie" },
  { key: "lighting", label: "Lighting", hint: "e.g. golden hour, rim light" },
  { key: "composition", label: "Composition", hint: "e.g. rule of thirds, negative space" },
  { key: "cameraAngle", label: "Camera angle", hint: "e.g. low angle, aerial" },
  { key: "style", label: "Style", hint: "e.g. watercolor, concept art" },
  { key: "materialsOrTextures", label: "Materials / textures", hint: "e.g. fur, weathered wood" },
  { key: "exclusions", label: "Exclusions", hint: "things to avoid in references" },
];

const MAX_QUERY_WORDS = 6;

function clip(query: string): string {
  return query.split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_WORDS).join(" ");
}

/** Removes queries that mention an excluded term; dedupes; clips length. */
export function cleanQueries(queries: string[], exclusions: string[] = []): string[] {
  const banned = exclusions.map((e) => e.toLowerCase()).filter(Boolean);
  return uniqueClean(
    queries
      .map((q) => clip(q.replace(/\s+/g, " ").trim()))
      .filter((q) => q.length > 0)
      .filter((q) => !banned.some((b) => q.toLowerCase().includes(b))),
  );
}

type Template = {
  id: string;
  name: string;
  purpose: string;
  priority: Priority;
  build: (f: ParsedFields) => string[];
};

const first = (list: string[]) => list[0] ?? "";

const TEMPLATES: Template[] = [
  {
    id: "subject",
    name: "Subject",
    purpose: "Anatomy, form and detail of the main subject",
    priority: "high",
    build: (f) =>
      f.subject.flatMap((s) => [
        s,
        `${s} reference photo`,
        `${s} pose reference`,
        `${s} close up detail`,
      ]),
  },
  {
    id: "environment",
    name: "Environment",
    purpose: "Setting, scale and atmosphere of the location",
    priority: "high",
    build: (f) =>
      f.environment.flatMap((e) => [
        e,
        `${e} photography`,
        `${e} concept art`,
        first(f.lighting) ? `${e} ${first(f.lighting)}` : "",
      ]),
  },
  {
    id: "lighting",
    name: "Lighting",
    purpose: "How light falls, its color and direction",
    priority: "high",
    build: (f) =>
      f.lighting.flatMap((l) => [
        `${l} lighting`,
        first(f.subject) ? `${l} ${first(f.subject)}` : "",
        first(f.environment) ? `${first(f.environment)} ${l}` : "",
        `${l} light study`,
      ]),
  },
  {
    id: "palette",
    name: "Color palette",
    purpose: "Color relationships to borrow",
    priority: "medium",
    build: (f) => {
      if (!f.palette.length) return [];
      const pair = f.palette.slice(0, 2).join(" ");
      return [
        `${pair} color palette`,
        first(f.environment) ? `${pair} ${first(f.environment)}` : "",
        `${pair} painting`,
        ...f.palette.slice(2, 4).map((p) => `${p} color palette`),
      ];
    },
  },
  {
    id: "mood",
    name: "Mood & atmosphere",
    purpose: "Emotional tone of the piece",
    priority: "medium",
    build: (f) =>
      f.mood.flatMap((m) => [
        `${m} atmosphere`,
        first(f.environment) ? `${m} ${first(f.environment)}` : "",
        `${m} mood painting`,
      ]),
  },
  {
    id: "composition",
    name: "Composition & camera",
    purpose: "Framing, viewpoint and layout ideas",
    priority: "medium",
    build: (f) => [
      ...f.cameraAngle.flatMap((c) => [
        first(f.subject) ? `${c} ${first(f.subject)}` : "",
        `${c} shot photography`,
      ]),
      ...f.composition.flatMap((c) => [
        `${c} composition`,
        first(f.subject) ? `${c} ${first(f.subject)}` : "",
      ]),
    ],
  },
  {
    id: "style",
    name: "Style",
    purpose: "Technique and rendering references",
    priority: "medium",
    build: (f) =>
      f.style.flatMap((s) => [
        first(f.subject) ? `${s} ${first(f.subject)}` : "",
        first(f.environment) ? `${s} ${first(f.environment)}` : "",
        `${s} technique`,
      ]),
  },
  {
    id: "materials",
    name: "Materials & textures",
    purpose: "Surface detail for close-up rendering",
    priority: "low",
    build: (f) =>
      f.materialsOrTextures.flatMap((m) => [
        `${m} texture`,
        `${m} texture close up`,
        `${m} macro photography`,
      ]),
  },
];

/** Builds reference categories from structured fields. Empty categories are skipped. */
export function planCategories(fields: ParsedFields, maxQueries = 5): ReferenceCategory[] {
  const categories: ReferenceCategory[] = [];
  for (const t of TEMPLATES) {
    const queries = cleanQueries(t.build(fields), fields.exclusions).slice(0, maxQueries);
    if (queries.length === 0) continue;
    categories.push({
      id: t.id,
      name: t.name,
      purpose: t.purpose,
      searchQueries: queries,
      priority: t.priority,
      enabled: true,
    });
  }
  return categories;
}

/** Union of parsed and manually entered fields (manual entries first). */
export function mergeFields(parsed: ParsedFields, manual: Partial<ParsedFields>): ParsedFields {
  const out = { ...parsed };
  for (const { key } of BRIEF_FIELDS) {
    const extra = manual[key];
    if (extra?.length) out[key] = uniqueClean([...extra, ...parsed[key]]);
  }
  return out;
}

export function fieldsOf(brief: ArtBrief): ParsedFields {
  return {
    subject: brief.subject,
    environment: brief.environment,
    palette: brief.palette,
    lighting: brief.lighting,
    mood: brief.mood,
    composition: brief.composition,
    cameraAngle: brief.cameraAngle,
    style: brief.style,
    materialsOrTextures: brief.materialsOrTextures,
    exclusions: brief.exclusions,
  };
}

/** One-line description of the brief, used as context for image analysis. */
export function briefSummary(brief: ArtBrief | null): string {
  if (!brief) return "";
  const parts = [
    brief.subject.join(", "),
    brief.environment.length ? `in ${brief.environment.join(", ")}` : "",
    brief.lighting.length ? `lighting: ${brief.lighting.join(", ")}` : "",
    brief.mood.length ? `mood: ${brief.mood.join(", ")}` : "",
    brief.style.length ? `style: ${brief.style.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("; ").slice(0, 600) || brief.originalPrompt.slice(0, 600);
}

/** Creates an empty category for manual searches. */
export function newManualCategory(
  existing: ReferenceCategory[],
  name = "Custom",
): ReferenceCategory {
  let n = existing.length + 1;
  let id = `custom-${n}`;
  while (existing.some((c) => c.id === id)) id = `custom-${++n}`;
  return { id, name, purpose: "", searchQueries: [], priority: "medium", enabled: true };
}
