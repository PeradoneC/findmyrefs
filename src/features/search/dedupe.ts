import type { ImageSearchResult, SearchHit } from "../../lib/types";
import { normalizeUrlForDedupe } from "../../lib/url";

export type RawHit = { result: ImageSearchResult; categoryId: string; query: string };

export function resultKey(result: Pick<ImageSearchResult, "provider" | "id">): string {
  return `${result.provider}:${result.id}`;
}

/**
 * Merges duplicate results. Two results are duplicates when they share a provider id,
 * a normalized source URL, or a thumbnail URL. The first occurrence wins; categories
 * and queries from later occurrences are merged into it.
 */
export function dedupeHits(raw: RawHit[], existing: SearchHit[] = []): SearchHit[] {
  const hits: SearchHit[] = existing.map((h) => ({
    ...h,
    categories: [...h.categories],
    queries: [...h.queries],
  }));
  const index = new Map<string, SearchHit>();
  const register = (hit: SearchHit) => {
    index.set(`id:${hit.key}`, hit);
    index.set(`url:${normalizeUrlForDedupe(hit.result.sourceUrl)}`, hit);
    const thumb = hit.result.thumbnailUrl;
    if (thumb && !thumb.startsWith("data:")) index.set(`thumb:${thumb}`, hit);
  };
  hits.forEach(register);

  for (const { result, categoryId, query } of raw) {
    const key = resultKey(result);
    const thumb =
      result.thumbnailUrl && !result.thumbnailUrl.startsWith("data:")
        ? `thumb:${result.thumbnailUrl}`
        : null;
    const match =
      index.get(`id:${key}`) ??
      index.get(`url:${normalizeUrlForDedupe(result.sourceUrl)}`) ??
      (thumb ? index.get(thumb) : undefined);
    if (match) {
      if (!match.categories.includes(categoryId)) match.categories.push(categoryId);
      if (!match.queries.includes(query)) match.queries.push(query);
      continue;
    }
    const hit: SearchHit = { key, result, categories: [categoryId], queries: [query], score: null };
    hits.push(hit);
    register(hit);
  }
  return hits;
}
