// Text/metadata relevance: what fraction of the query's words appear in the result's
// title and tags. It is an estimate based on metadata only - nothing about the image
// itself has been inspected - and the UI labels it that way.

import type { SearchHit } from "../../lib/types";

const STOPWORDS = new Set(
  "a an and the of in on at for with to from by or photo photography reference image picture study close up detail".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function stem(t: string): string {
  return t.length > 4 ? t.replace(/(ies|es|s)$/, "") : t;
}

/** 0..1 score, or null when the result has no usable metadata or the query has no terms. */
export function textMatchScore(
  queries: string[],
  title: string,
  tags: string[] = [],
  exclusions: string[] = [],
): number | null {
  const haystack = new Set([...tokenize(title), ...tags.flatMap(tokenize)].map(stem));
  if (haystack.size === 0) return null;
  let best: number | null = null;
  for (const q of queries) {
    const terms = [...new Set(tokenize(q).map(stem))];
    if (terms.length === 0) continue;
    const found = terms.filter((t) => haystack.has(t)).length / terms.length;
    best = best === null ? found : Math.max(best, found);
  }
  if (best === null) return null;
  const excluded = exclusions
    .flatMap(tokenize)
    .map(stem)
    .some((t) => haystack.has(t));
  return excluded ? best * 0.25 : best;
}

export function rankHits(hits: SearchHit[], exclusions: string[] = []): SearchHit[] {
  const scored = hits.map((h, i) => ({
    hit: { ...h, score: textMatchScore(h.queries, h.result.title, h.result.tags, exclusions) },
    i,
  }));
  scored.sort((a, b) => (b.hit.score ?? -1) - (a.hit.score ?? -1) || a.i - b.i);
  return scored.map((s) => s.hit);
}
