// Optional image analysis. Off by default; runs only on images the user selects and
// confirms. The mock analyzer is free and works from metadata only. The Anthropic
// analyzer is paid and runs in the backend (which also caches results and enforces
// the batch limit and spending guardrails).

import type { Backend } from "../../lib/backend";
import { BackendError } from "../../lib/backend";
import { parseReferenceAnalysis } from "../../lib/schemas";
import type { AppSettings, ImageAnalysisItem, ReferenceAnalysis, SearchHit } from "../../lib/types";
import { isHttpsUrl } from "../../lib/url";
import { textMatchScore } from "../search/ranking";

export type ImageAnalysisInput = {
  sourceId: string;
  imageUrl?: string;
  title: string;
  tags?: string[];
  queries: string[];
  categoryHint: string;
  briefSummary: string;
};

export interface ImageAnalysisProvider {
  id: string;
  displayName: string;
  isPaid: boolean;
  analyzeImage(input: ImageAnalysisInput): Promise<ReferenceAnalysis>;
}

export const MOCK_ANALYSIS_MODEL = "mock-metadata";
export const MOCK_ANALYSIS_VERSION = 1;
/** Must match ANALYSIS_VERSION in src-tauri/src/providers/anthropic.rs. */
export const ANTHROPIC_ANALYSIS_VERSION = 1;

/** Same format as `analysis_cache_key` in the Rust backend. */
export function analysisCacheKey(
  provider: string,
  model: string,
  sourceId: string,
  version: number,
): string {
  return `${provider}|${model}|${sourceId}|v${version}`;
}

/** Demo analyzer: never looks at pixels and says so. Deterministic, no network. */
export const mockImageAnalysisProvider: ImageAnalysisProvider = {
  id: "mock",
  displayName: "Mock analysis (free, metadata only)",
  isPaid: false,
  async analyzeImage(input) {
    const score = textMatchScore(input.queries, input.title, input.tags);
    const pct = score === null ? null : Math.round(score * 100);
    return {
      summary: `Demo analysis generated from metadata only - the image itself was not inspected. Title: "${input.title.slice(0, 120)}".`,
      detectedCategories: input.categoryHint ? [input.categoryHint] : [],
      relevanceExplanation:
        pct === null
          ? "No title or tags to compare against the search queries."
          : `About ${pct}% of the search query words appear in the title/tags. This says nothing about the image content.`,
    };
  },
};

export type AnalysisOutcome = {
  key: string;
  analysis?: ReferenceAnalysis;
  error?: string;
  fromCache: boolean;
};

export type AnalysisPlan = {
  provider: "mock" | "anthropic";
  model: string;
  limit: number;
  overLimit: boolean;
  /** Hits that have a cached analysis (no request needed). */
  cachedKeys: string[];
  /** Hits that would be sent to the provider. */
  toSend: SearchHit[];
  /** Hits that cannot be analyzed by this provider (e.g. demo images with a paid provider). */
  unsupported: { key: string; reason: string }[];
};

function providerOf(settings: AppSettings): {
  provider: "mock" | "anthropic";
  model: string;
  version: number;
} {
  return settings.aiProvider === "anthropic"
    ? { provider: "anthropic", model: settings.anthropicModel, version: ANTHROPIC_ANALYSIS_VERSION }
    : { provider: "mock", model: MOCK_ANALYSIS_MODEL, version: MOCK_ANALYSIS_VERSION };
}

/** Works out what an "Analyze selected" action would do, before anything is sent. */
export async function planAnalysis(
  backend: Backend,
  hits: SearchHit[],
  settings: AppSettings,
): Promise<AnalysisPlan> {
  const { provider, model, version } = providerOf(settings);
  const unsupported: AnalysisPlan["unsupported"] = [];
  const candidates: SearchHit[] = [];
  for (const hit of hits) {
    if (provider === "anthropic" && (hit.result.isDemo || !isHttpsUrl(hit.result.thumbnailUrl))) {
      unsupported.push({
        key: hit.key,
        reason: hit.result.isDemo
          ? "Demo images are never sent to a paid provider."
          : "This result has no https thumbnail that can be analyzed.",
      });
    } else {
      candidates.push(hit);
    }
  }
  const keys = candidates.map((h) => analysisCacheKey(provider, model, h.key, version));
  const cached = keys.length ? await backend.getCachedAnalyses(keys) : [];
  const cachedSet = new Set(cached.map((c) => c.sourceId));
  return {
    provider,
    model,
    limit: settings.maxImagesPerBatch,
    overLimit: hits.length > settings.maxImagesPerBatch,
    cachedKeys: candidates.filter((h) => cachedSet.has(h.key)).map((h) => h.key),
    toSend: candidates.filter((h) => !cachedSet.has(h.key)),
    unsupported,
  };
}

export type RunAnalysisOptions = {
  /** Must be true and come from an explicit user confirmation for paid providers. */
  confirmed: boolean;
  forceRefresh?: boolean;
  categoryName: (hit: SearchHit) => string;
  briefSummary: string;
};

export async function runAnalysis(
  backend: Backend,
  hits: SearchHit[],
  settings: AppSettings,
  options: RunAnalysisOptions,
): Promise<AnalysisOutcome[]> {
  if (hits.length > settings.maxImagesPerBatch) {
    throw new BackendError(
      "guard",
      "batch_too_large",
      `Too many images selected: ${hits.length} (your batch limit is ${settings.maxImagesPerBatch}).`,
    );
  }
  const { provider, model, version } = providerOf(settings);

  if (provider === "mock") {
    const keys = hits.map((h) => analysisCacheKey("mock", model, h.key, version));
    const cached = options.forceRefresh ? [] : await backend.getCachedAnalyses(keys);
    const out: AnalysisOutcome[] = [];
    for (const hit of hits) {
      const hitCache = cached.find((c) => c.sourceId === hit.key);
      const parsed = hitCache ? parseReferenceAnalysis(hitCache.analysisJson) : null;
      if (parsed?.ok) {
        out.push({ key: hit.key, analysis: parsed.value, fromCache: true });
        continue;
      }
      const analysis = await mockImageAnalysisProvider.analyzeImage({
        sourceId: hit.key,
        title: hit.result.title,
        tags: hit.result.tags,
        queries: hit.queries,
        categoryHint: options.categoryName(hit),
        briefSummary: options.briefSummary,
      });
      await backend.putCachedAnalysis({
        cacheKey: analysisCacheKey("mock", model, hit.key, version),
        provider: "mock",
        model,
        sourceId: hit.key,
        analysisVersion: version,
        analysisJson: JSON.stringify(analysis),
        createdAt: new Date().toISOString(),
      });
      out.push({ key: hit.key, analysis, fromCache: false });
    }
    return out;
  }

  // Paid path.
  if (!options.confirmed) {
    throw new BackendError(
      "guard",
      "not_confirmed",
      "Paid AI requests need an explicit confirmation from you.",
    );
  }
  const sendable = hits.filter((h) => !h.result.isDemo && isHttpsUrl(h.result.thumbnailUrl));
  const skipped: AnalysisOutcome[] = hits
    .filter((h) => !sendable.includes(h))
    .map((h) => ({
      key: h.key,
      error: "Not sent: demo images and non-https thumbnails are never sent to a paid provider.",
      fromCache: false,
    }));
  if (sendable.length === 0) return skipped;

  const items: ImageAnalysisItem[] = sendable.map((h) => ({
    sourceId: h.key,
    imageUrl: h.result.thumbnailUrl as string,
    title: h.result.title,
    categoryHint: options.categoryName(h),
    briefSummary: options.briefSummary,
  }));
  const results = await backend.anthropicAnalyzeImages(items, {
    confirmed: true,
    forceRefresh: options.forceRefresh ?? false,
  });
  const out = results.map((r): AnalysisOutcome => {
    if (r.status === "ok" && r.analysisJson) {
      const parsed = parseReferenceAnalysis(r.analysisJson);
      return parsed.ok
        ? { key: r.sourceId, analysis: parsed.value, fromCache: r.fromCache }
        : { key: r.sourceId, error: `Invalid analysis: ${parsed.error}`, fromCache: r.fromCache };
    }
    return { key: r.sourceId, error: r.error?.message ?? "Analysis failed", fromCache: false };
  });
  return [...out, ...skipped];
}
