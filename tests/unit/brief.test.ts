import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArtBrief, emptyBrief } from "../../src/lib/schemas";
import { parseBriefText, splitFieldInput } from "../../src/features/brief/basicParser";
import {
  cleanQueries,
  planCategories,
  newManualCategory,
} from "../../src/features/brief/queryPlanner";
import {
  analyzeBriefDeterministic,
  composePromptWithFields,
  createAnthropicBriefProvider,
  mockBriefProvider,
} from "../../src/features/brief/briefProviders";
import { createBrowserBackend } from "../../src/lib/backend/browserBackend";
import type { Backend } from "../../src/lib/backend";

const FOX =
  "A lonely red fox in a misty bamboo forest at golden hour, watercolor, low angle, muted greens, fur texture. No people.";

afterEach(() => vi.restoreAllMocks());

describe("ArtBrief schema validation", () => {
  it("accepts a valid brief and fills defaults", () => {
    const r = parseArtBrief({
      originalPrompt: "fox",
      subject: ["fox"],
      referenceCategories: [
        { id: "subject", name: "Subject", searchQueries: ["fox"], priority: "high" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.palette).toEqual([]);
      expect(r.value.referenceCategories[0]?.purpose).toBe("");
    }
  });

  it("rejects invalid priority, missing categories and malformed JSON", () => {
    expect(
      parseArtBrief({
        referenceCategories: [{ id: "a", name: "A", searchQueries: [], priority: "urgent" }],
      }).ok,
    ).toBe(false);
    expect(parseArtBrief({ subject: ["x"] }).ok).toBe(false);
    expect(parseArtBrief("{not json").ok).toBe(false);
    expect(parseArtBrief(null).ok).toBe(false);
    expect(parseArtBrief({ referenceCategories: "nope" }).ok).toBe(false);
  });

  it("cleans lists: trims, drops empties and duplicates, clips length", () => {
    const r = parseArtBrief({
      subject: ["  fox ", "", "FOX", "x".repeat(500)],
      referenceCategories: [],
    });
    expect(r.ok && r.value.subject).toEqual(["fox", "x".repeat(120)]);
  });

  it("makes duplicate category ids unique", () => {
    const cat = { id: "same", name: "A", searchQueries: ["q"], priority: "low" };
    const r = parseArtBrief({ referenceCategories: [cat, { ...cat, name: "B" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Set(r.value.referenceCategories.map((c) => c.id)).size).toBe(2);
  });

  it("emptyBrief is itself valid", () => {
    expect(parseArtBrief(emptyBrief("x")).ok).toBe(true);
  });
});

describe("basic deterministic parser", () => {
  it("extracts structured fields from an English brief", () => {
    const f = parseBriefText(FOX);
    expect(f.subject).toEqual(["red fox"]);
    expect(f.environment).toContain("misty bamboo forest");
    expect(f.lighting).toEqual(["golden hour"]);
    expect(f.mood).toEqual(["lonely"]);
    expect(f.style).toEqual(["watercolor"]);
    expect(f.cameraAngle).toEqual(["low angle"]);
    expect(f.palette).toEqual(expect.arrayContaining(["muted", "green"]));
    expect(f.palette).not.toContain("golden"); // part of "golden hour"
    expect(f.materialsOrTextures).toEqual(["fur"]);
    expect(f.exclusions).toEqual(["people"]);
  });

  it("maps Thai vocabulary to English", () => {
    const f = parseBriefText("วัดเก่าในป่า ตอนพระอาทิตย์ตก บรรยากาศลึกลับ สีทอง ไม่เอาคน");
    expect(f.environment).toEqual(expect.arrayContaining(["temple", "forest"]));
    expect(f.lighting).toContain("sunset");
    expect(f.mood).toContain("mysterious");
    expect(f.palette).toContain("gold");
    expect(f.exclusions.length).toBe(1);
  });

  it("splits comma separated field input", () => {
    expect(splitFieldInput("teal, orange,, Teal\nmuted")).toEqual(["teal", "orange", "muted"]);
  });
});

describe("query planner", () => {
  const fields = parseBriefText(FOX);
  const categories = planCategories(fields);

  it("creates prioritized categories with several distinct queries each", () => {
    expect(categories.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "subject",
        "environment",
        "lighting",
        "palette",
        "mood",
        "style",
        "materials",
      ]),
    );
    for (const c of categories) {
      expect(c.searchQueries.length).toBeGreaterThan(0);
      expect(new Set(c.searchQueries.map((q) => q.toLowerCase())).size).toBe(
        c.searchQueries.length,
      );
    }
    expect(categories.find((c) => c.id === "subject")?.priority).toBe("high");
  });

  it("keeps queries concise and does not just repeat the prompt", () => {
    for (const q of categories.flatMap((c) => c.searchQueries)) {
      expect(q.split(/\s+/).length).toBeLessThanOrEqual(6);
      expect(q).not.toBe(FOX);
    }
  });

  it("keeps excluded terms out of queries", () => {
    expect(cleanQueries(["people walking", "forest path"], ["people"])).toEqual(["forest path"]);
  });

  it("skips categories without information", () => {
    const empty = planCategories({
      ...fields,
      palette: [],
      mood: [],
      style: [],
      materialsOrTextures: [],
    });
    expect(empty.find((c) => c.id === "palette")).toBeUndefined();
  });

  it("creates unique manual categories", () => {
    const a = newManualCategory([]);
    const b = newManualCategory([a]);
    expect(a.id).not.toBe(b.id);
  });
});

describe("mock brief provider (free)", () => {
  it("is deterministic, labeled as mock, and makes no network requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const a = await mockBriefProvider.analyzeBrief(FOX);
    const b = await mockBriefProvider.analyzeBrief(FOX);
    expect(a).toEqual(b);
    expect(a.generatedBy).toBe("mock");
    expect(a.originalPrompt).toBe(FOX);
    expect(mockBriefProvider.isPaid).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(parseArtBrief(a).ok).toBe(true);
  });

  it("merges manual fields with parsed ones", () => {
    const brief = analyzeBriefDeterministic("a knight", {
      palette: ["teal"],
      exclusions: ["text"],
    });
    expect(brief.palette).toContain("teal");
    expect(brief.exclusions).toContain("text");
    expect(brief.referenceCategories.some((c) => c.id === "palette")).toBe(true);
  });

  it("uses unknown words as the subject", () => {
    const brief = analyzeBriefDeterministic("Zorblax quintessence");
    expect(brief.subject[0]).toBe("zorblax quintessence");
    expect(brief.referenceCategories.length).toBeGreaterThan(0);
  });

  it("falls back to the prompt start when no subject can be extracted", () => {
    const brief = analyzeBriefDeterministic("แมวน่ารัก");
    expect(brief.subject[0]).toBe("แมวน่ารัก");
    expect(brief.referenceCategories[0]?.searchQueries[0]).toBe("แมวน่ารัก");
  });
});

describe("Anthropic brief provider (paid, via backend)", () => {
  function fakeBackend(briefJson: string) {
    const base = createBrowserBackend({ storage: null });
    const anthropicAnalyzeBrief = vi.fn(async () => ({
      briefJson,
      usage: {
        id: "u",
        createdAt: "",
        provider: "anthropic",
        model: "claude-opus-5-5",
        feature: "brief_analysis",
        imageCount: 0,
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0.0002,
        status: "ok",
        errorCode: null,
      },
    }));
    return { backend: { ...base, anthropicAnalyzeBrief } as Backend, anthropicAnalyzeBrief };
  }

  it("sends an explicitly confirmed request and validates the response", async () => {
    const brief = analyzeBriefDeterministic("fox");
    const { backend, anthropicAnalyzeBrief } = fakeBackend(JSON.stringify(brief));
    const provider = createAnthropicBriefProvider(backend);
    const out = await provider.analyzeConfirmed("my words", { palette: ["teal"] });
    expect(anthropicAnalyzeBrief).toHaveBeenCalledWith(
      expect.stringContaining("Palette: teal"),
      true,
    );
    expect(out.brief.originalPrompt).toBe("my words");
    expect(out.brief.palette).toContain("teal");
    expect(out.brief.generatedBy).toBe("anthropic");
  });

  it("rejects an invalid AI response safely", async () => {
    const { backend } = fakeBackend(JSON.stringify({ hello: "world" }));
    await expect(createAnthropicBriefProvider(backend).analyzeConfirmed("x")).rejects.toMatchObject(
      {
        code: "invalid_response",
      },
    );
  });

  it("is unavailable in the browser backend (keys never live in the browser)", async () => {
    const backend = createBrowserBackend({ storage: null });
    await expect(createAnthropicBriefProvider(backend).analyzeConfirmed("x")).rejects.toMatchObject(
      {
        code: "desktop_only",
      },
    );
  });

  it("composes manual fields into the prompt", () => {
    expect(composePromptWithFields("fox", {})).toBe("fox");
    expect(composePromptWithFields("fox", { mood: ["calm"] })).toContain("Mood: calm");
  });
});
