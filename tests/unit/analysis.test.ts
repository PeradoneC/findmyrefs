import { describe, expect, it, vi } from "vitest";
import {
  analysisCacheKey,
  ANTHROPIC_ANALYSIS_VERSION,
  mockImageAnalysisProvider,
  planAnalysis,
  runAnalysis,
} from "../../src/features/analysis/imageAnalysis";
import { createBrowserBackend, DEFAULT_SETTINGS } from "../../src/lib/backend/browserBackend";
import type { Backend } from "../../src/lib/backend";
import type { AppSettings, ImageAnalysisItemResult, SearchHit } from "../../src/lib/types";

function hit(id: string, opts: { demo?: boolean; thumb?: string } = {}): SearchHit {
  return {
    key: `openverse:${id}`,
    categories: ["subject"],
    queries: ["red fox"],
    score: null,
    result: {
      id,
      title: `Red fox ${id}`,
      sourceUrl: `https://example.org/${id}`,
      thumbnailUrl: opts.thumb ?? `https://api.openverse.org/v1/images/${id}/thumb/`,
      provider: "openverse",
      isDemo: opts.demo ?? false,
      tags: ["fox"],
    },
  };
}

const options = { confirmed: true, categoryName: () => "Subject", briefSummary: "fox" };

function backendWithPaidSpy() {
  const base = createBrowserBackend({ storage: null });
  const anthropicAnalyzeImages = vi.fn(
    async (items: { sourceId: string }[]): Promise<ImageAnalysisItemResult[]> =>
      items.map((i) => ({
        sourceId: i.sourceId,
        cacheKey: "k",
        status: "ok",
        fromCache: false,
        analysisJson: JSON.stringify({
          summary: "A fox",
          detectedCategories: [],
          relevanceExplanation: "fits",
        }),
        error: null,
      })),
  );
  const anthropicAnalyzeBrief = vi.fn();
  const backend = { ...base, anthropicAnalyzeImages, anthropicAnalyzeBrief } as unknown as Backend;
  return { backend, anthropicAnalyzeImages, anthropicAnalyzeBrief };
}

const paidSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  aiProvider: "anthropic",
  paidWarningAcknowledged: true,
};

describe("image analysis cost controls", () => {
  it("cache key format matches the Rust backend", () => {
    expect(
      analysisCacheKey("anthropic", "claude-opus-5-5", "openverse:1", ANTHROPIC_ANALYSIS_VERSION),
    ).toBe("anthropic|claude-opus-5-5|openverse:1|v1");
  });

  it("enforces the batch limit before anything runs", async () => {
    const { backend, anthropicAnalyzeImages } = backendWithPaidSpy();
    const hits = [hit("1"), hit("2"), hit("3"), hit("4")];
    await expect(runAnalysis(backend, hits, paidSettings, options)).rejects.toMatchObject({
      code: "batch_too_large",
    });
    await expect(runAnalysis(backend, hits, DEFAULT_SETTINGS, options)).rejects.toMatchObject({
      code: "batch_too_large",
    });
    expect(anthropicAnalyzeImages).not.toHaveBeenCalled();
    const plan = await planAnalysis(backend, hits, paidSettings);
    expect(plan.overLimit).toBe(true);
    expect(plan.limit).toBe(3);
  });

  it("paid requests require explicit confirmation", async () => {
    const { backend, anthropicAnalyzeImages } = backendWithPaidSpy();
    await expect(
      runAnalysis(backend, [hit("1")], paidSettings, { ...options, confirmed: false }),
    ).rejects.toMatchObject({
      code: "not_confirmed",
    });
    expect(anthropicAnalyzeImages).not.toHaveBeenCalled();
  });

  it("mock mode never calls the paid provider or the network", async () => {
    const { backend, anthropicAnalyzeImages, anthropicAnalyzeBrief } = backendWithPaidSpy();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await runAnalysis(backend, [hit("1"), hit("2")], DEFAULT_SETTINGS, options);
    expect(out.every((o) => o.analysis)).toBe(true);
    expect(anthropicAnalyzeImages).not.toHaveBeenCalled();
    expect(anthropicAnalyzeBrief).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("cached mock analyses prevent repeated work", async () => {
    const { backend } = backendWithPaidSpy();
    const spy = vi.spyOn(mockImageAnalysisProvider, "analyzeImage");
    await runAnalysis(backend, [hit("1")], DEFAULT_SETTINGS, options);
    const second = await runAnalysis(backend, [hit("1")], DEFAULT_SETTINGS, options);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second[0]?.fromCache).toBe(true);
    const plan = await planAnalysis(backend, [hit("1"), hit("2")], DEFAULT_SETTINGS);
    expect(plan.cachedKeys).toEqual(["openverse:1"]);
    expect(plan.toSend.map((h) => h.key)).toEqual(["openverse:2"]);
    // Manual re-run ignores the cache.
    await runAnalysis(backend, [hit("1")], DEFAULT_SETTINGS, { ...options, forceRefresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("never sends demo images or non-https thumbnails to the paid provider", async () => {
    const { backend, anthropicAnalyzeImages } = backendWithPaidSpy();
    const out = await runAnalysis(
      backend,
      [
        hit("demo", { demo: true, thumb: "data:image/svg+xml,<svg/>" }),
        hit("http", { thumb: "http://x.org/a.jpg" }),
        hit("ok"),
      ],
      paidSettings,
      options,
    );
    expect(anthropicAnalyzeImages).toHaveBeenCalledTimes(1);
    const sent = (anthropicAnalyzeImages.mock.calls[0] as unknown[])[0] as {
      sourceId: string;
      imageUrl: string;
    }[];
    expect(sent.map((i) => i.sourceId)).toEqual(["openverse:ok"]);
    expect(out.filter((o) => o.error)).toHaveLength(2);
    const plan = await planAnalysis(backend, [hit("demo", { demo: true })], paidSettings);
    expect(plan.unsupported).toHaveLength(1);
  });

  it("handles invalid paid analysis responses safely", async () => {
    const base = createBrowserBackend({ storage: null });
    const backend = {
      ...base,
      anthropicAnalyzeImages: async () => [
        {
          sourceId: "openverse:1",
          cacheKey: "k",
          status: "ok",
          fromCache: false,
          analysisJson: '{"oops":1}',
          error: null,
        },
      ],
    } as unknown as Backend;
    const out = await runAnalysis(backend, [hit("1")], paidSettings, options);
    expect(out[0]?.analysis).toBeUndefined();
    expect(out[0]?.error).toMatch(/Invalid analysis/);
  });

  it("mock analysis states that the image was not inspected", async () => {
    const a = await mockImageAnalysisProvider.analyzeImage({
      sourceId: "x",
      title: "Red fox",
      queries: ["red fox"],
      categoryHint: "Subject",
      briefSummary: "",
    });
    expect(a.summary).toMatch(/not inspected/);
    expect(a.palette).toBeUndefined();
  });
});
