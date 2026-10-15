import type { ArtBrief, QueryError, ReferenceCategory, SearchHit } from "../../lib/types";
import { dedupeHits, type RawHit } from "./dedupe";
import { rankHits } from "./ranking";
import { SearchProviderError, withTimeout, type ImageSearchProvider } from "./providers/types";

export type PlanItem = { categoryId: string; query: string };

/** The first `queriesPerCategory` queries of every enabled category, high priority first. */
export function buildSearchPlan(
  categories: ReferenceCategory[],
  queriesPerCategory: number,
): PlanItem[] {
  const order = { high: 0, medium: 1, low: 2 } as const;
  return [...categories]
    .filter((c) => c.enabled !== false)
    .sort((a, b) => order[a.priority] - order[b.priority])
    .flatMap((c) =>
      c.searchQueries
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, queriesPerCategory)
        .map((query) => ({ categoryId: c.id, query })),
    );
}

export type SearchRunOptions = {
  provider: ImageSearchProvider;
  plan: PlanItem[];
  page?: number;
  safeSearch?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** Called after each successful query with all raw results so far (for progressive display). */
  onResults?: (raw: RawHit[]) => void;
};

export type SearchRunOutput = {
  raw: RawHit[];
  errors: QueryError[];
  counts: { item: PlanItem; count: number }[];
};

function describe(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof SearchProviderError) return { message: err.message, retryable: err.retryable };
  return { message: err instanceof Error ? err.message : "Unknown search error", retryable: true };
}

/** Runs every plan item with limited concurrency. One failing query never fails the run. */
export async function runSearch(opts: SearchRunOptions): Promise<SearchRunOutput> {
  const {
    provider,
    plan,
    page = 1,
    safeSearch = true,
    concurrency = 2,
    timeoutMs = 35_000,
    signal,
  } = opts;
  const raw: RawHit[] = [];
  const errors: QueryError[] = [];
  const counts: { item: PlanItem; count: number }[] = [];
  let next = 0;
  let done = 0;
  // After a rate limit or an access problem, the remaining queries would fail the
  // same way, so they are skipped instead of sent.
  let stopped: { message: string; retryable: boolean } | null = null;

  async function worker() {
    while (next < plan.length) {
      const item = plan[next++];
      if (!item) break;
      if (signal?.aborted) return;
      if (stopped) {
        errors.push({ ...item, ...stopped });
      } else {
        try {
          const results = await withTimeout(timeoutMs, signal, (s) =>
            provider.search({ query: item.query, page, safeSearch }, s),
          );
          counts.push({ item, count: results.length });
          for (const result of results)
            raw.push({ result, categoryId: item.categoryId, query: item.query });
          if (results.length && !signal?.aborted) opts.onResults?.([...raw]);
        } catch (err) {
          if (signal?.aborted) return;
          if (err instanceof SearchProviderError && err.kind === "rate_limit") {
            stopped = {
              message: "Skipped: the provider's rate limit was reached.",
              retryable: true,
            };
          } else if (err instanceof SearchProviderError && err.kind === "auth") {
            stopped = {
              message: "Skipped: the provider is not available (see the first error).",
              retryable: false,
            };
          }
          errors.push({ ...item, ...describe(err) });
        }
      }
      done++;
      opts.onProgress?.(done, plan.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, plan.length)) }, worker),
  );
  return { raw, errors, counts };
}

/** Merges new raw results into existing hits, then ranks by text match. */
export function buildHits(
  raw: RawHit[],
  brief: ArtBrief | null,
  existing: SearchHit[] = [],
): SearchHit[] {
  return rankHits(dedupeHits(raw, existing), brief?.exclusions ?? []);
}
