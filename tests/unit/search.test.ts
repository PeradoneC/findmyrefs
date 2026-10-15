import { describe, expect, it, vi } from "vitest";
import {
  createOpenverseProvider,
  licenseLabel,
  normalizeOpenverseResponse,
  normalizeOpenverseResult,
} from "../../src/features/search/providers/openverseProvider";
import {
  createMockSearchProvider,
  MOCK_PAGE_SIZE,
} from "../../src/features/search/providers/mockSearchProvider";
import {
  SearchProviderError,
  type ImageSearchProvider,
} from "../../src/features/search/providers/types";
import { dedupeHits, resultKey, type RawHit } from "../../src/features/search/dedupe";
import { rankHits, textMatchScore } from "../../src/features/search/ranking";
import { buildHits, buildSearchPlan, runSearch } from "../../src/features/search/searchRunner";
import { WEB_SEARCH_SITES } from "../../src/features/search/providers/webSearchLinks";
import type { ImageSearchResult, ReferenceCategory } from "../../src/lib/types";
import { isSafeHttpUrl, normalizeUrlForDedupe, safeImageSrc } from "../../src/lib/url";

const rawOpenverse = {
  id: "a05f2b1b",
  title: "Red Fox",
  foreign_landing_url: "https://www.flickr.com/photos/x/5738555148",
  url: "https://live.staticflickr.com/5306/5738555148_b.jpg",
  creator: "-Category 5-",
  creator_url: "https://www.flickr.com/photos/x",
  license: "by-nc-nd",
  license_version: "2.0",
  license_url: "https://creativecommons.org/licenses/by-nc-nd/2.0/",
  provider: "flickr",
  source: "flickr",
  thumbnail: "https://api.openverse.org/v1/images/a05f2b1b/thumb/",
  width: 1024,
  height: 685,
  tags: [{ name: "fox" }, { name: "red" }, { bogus: true }],
};

function result(id: string, overrides: Partial<ImageSearchResult> = {}): ImageSearchResult {
  return {
    id,
    title: `Result ${id}`,
    sourceUrl: `https://example.org/${id}`,
    provider: "test",
    isDemo: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("URL helpers", () => {
  it("only accepts http(s) URLs", () => {
    expect(isSafeHttpUrl("https://a.org/x")).toBe(true);
    for (const bad of ["javascript:alert(1)", "file:///c:/x", "data:text/html,x", "", "nope", 42]) {
      expect(isSafeHttpUrl(bad)).toBe(false);
    }
    expect(safeImageSrc("data:image/svg+xml,<svg/>")).toBeDefined();
    expect(safeImageSrc("data:image/png;base64,AAA")).toBeUndefined();
  });

  it("normalizes URLs for duplicate detection", () => {
    const a = normalizeUrlForDedupe("https://www.Flickr.com/photos/1/?utm_source=x&b=2&a=1#frag");
    const b = normalizeUrlForDedupe("http://flickr.com/photos/1?a=1&b=2");
    expect(a).toBe(b);
  });
});

describe("Openverse normalization", () => {
  it("maps fields into the internal schema with attribution", () => {
    const r = normalizeOpenverseResult(rawOpenverse);
    expect(r).toMatchObject({
      id: "a05f2b1b",
      title: "Red Fox",
      sourceUrl: rawOpenverse.foreign_landing_url,
      thumbnailUrl: rawOpenverse.thumbnail,
      provider: "openverse",
      providerSource: "flickr",
      creatorName: "-Category 5-",
      width: 1024,
      height: 685,
      licenseLabel: "CC BY-NC-ND 2.0",
      isDemo: false,
      tags: ["fox", "red"],
    });
  });

  it("drops results without an id or a safe source URL, and unsafe thumbnails", () => {
    expect(normalizeOpenverseResult({ ...rawOpenverse, id: "" })).toBeNull();
    expect(
      normalizeOpenverseResult({
        ...rawOpenverse,
        foreign_landing_url: "javascript:alert(1)",
        url: "ftp://x",
      }),
    ).toBeNull();
    expect(
      normalizeOpenverseResult({ ...rawOpenverse, thumbnail: "javascript:x" })?.thumbnailUrl,
    ).toBeUndefined();
    expect(normalizeOpenverseResult("garbage")).toBeNull();
  });

  it("handles invalid metadata types", () => {
    const r = normalizeOpenverseResult({
      ...rawOpenverse,
      width: "big",
      height: -5,
      title: 7,
      tags: "x",
    });
    expect(r?.width).toBeUndefined();
    expect(r?.height).toBeUndefined();
    expect(r?.title).toBe("Untitled");
    expect(r?.tags).toBeUndefined();
  });

  it("rejects unexpected response shapes", () => {
    expect(() => normalizeOpenverseResponse({ nope: true })).toThrow(SearchProviderError);
    expect(normalizeOpenverseResponse({ results: [rawOpenverse, null] })).toHaveLength(1);
  });

  it("labels licenses", () => {
    expect(licenseLabel("cc0")).toMatch(/CC0/);
    expect(licenseLabel("pdm")).toMatch(/Public Domain/);
    expect(licenseLabel(undefined)).toBeUndefined();
  });
});

describe("Openverse provider errors", () => {
  const provider = (fetchImpl: typeof fetch, timeoutMs = 1000) =>
    createOpenverseProvider({ fetchImpl, timeoutMs });

  it("builds an official API request with safe search", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [rawOpenverse] }));
    const out = await provider(fetchImpl).search({ query: "red fox", page: 2, safeSearch: true });
    expect(out).toHaveLength(1);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(url.searchParams.get("q")).toBe("red fox");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("mature")).toBe("false");
  });

  it("maps rate limits", async () => {
    const err = await provider(async () => jsonResponse({}, 429, { "retry-after": "30" }))
      .search({ query: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SearchProviderError);
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterSeconds).toBe(30);
  });

  it("maps server errors, network errors and invalid JSON", async () => {
    await expect(
      provider(async () => jsonResponse({}, 500)).search({ query: "x" }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
    await expect(
      provider(async () => {
        throw new TypeError("Failed to fetch");
      }).search({ query: "x" }),
    ).rejects.toMatchObject({ kind: "network" });
    await expect(
      provider(async () => jsonResponse("<html>")).search({ query: "x" }),
    ).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("times out slow requests", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    await expect(provider(hanging, 30).search({ query: "x" })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("returns empty arrays for empty results and blank queries", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    expect(await provider(fetchImpl).search({ query: "x" })).toEqual([]);
    expect(await provider(fetchImpl).search({ query: "   " })).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("mock (demo) search provider", () => {
  const mock = createMockSearchProvider({ delayMs: 0, slowMs: 200 });

  it("returns clearly labeled demo data and never claims to be live", async () => {
    expect(mock.isLive).toBe(false);
    const out = await mock.search({ query: "red fox" });
    expect(out).toHaveLength(MOCK_PAGE_SIZE);
    for (const r of out) {
      expect(r.isDemo).toBe(true);
      expect(r.title.startsWith("Demo:")).toBe(true);
      expect(new URL(r.sourceUrl).hostname).toBe("example.com");
      expect(r.licenseLabel).toMatch(/not a real image/i);
      expect(r.thumbnailUrl?.startsWith("data:image/svg+xml")).toBe(true);
    }
  });

  it("is deterministic and paginates", async () => {
    const a = await mock.search({ query: "fox", page: 1 });
    const b = await mock.search({ query: "fox", page: 1 });
    const c = await mock.search({ query: "fox", page: 2 });
    expect(a).toEqual(b);
    expect(c[0]?.id).not.toBe(a[0]?.id);
    expect(await mock.search({ query: "fox", page: 99 })).toEqual([]);
  });

  it("makes no network requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await mock.search({ query: "anything" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("simulates errors and empty responses for testing", async () => {
    await expect(mock.search({ query: "x __error__" })).rejects.toBeInstanceOf(SearchProviderError);
    expect(await mock.search({ query: "x __empty__" })).toEqual([]);
  });
});

describe("duplicate detection", () => {
  it("merges results with the same id, normalized URL or thumbnail", () => {
    const raw: RawHit[] = [
      { result: result("1"), categoryId: "subject", query: "fox" },
      { result: result("1"), categoryId: "lighting", query: "fox light" }, // same id
      {
        result: result("2", { sourceUrl: "https://www.example.org/1/?utm_source=z" }),
        categoryId: "mood",
        query: "m",
      }, // same URL
      {
        result: result("3", { thumbnailUrl: "https://t.org/a.jpg" }),
        categoryId: "subject",
        query: "fox",
      },
      {
        result: result("4", { thumbnailUrl: "https://t.org/a.jpg" }),
        categoryId: "subject",
        query: "fox 2",
      }, // same thumb
      { result: result("5"), categoryId: "subject", query: "fox" },
    ];
    const hits = dedupeHits(raw);
    expect(hits.map((h) => h.result.id)).toEqual(["1", "3", "5"]);
    expect(hits[0]?.categories).toEqual(["subject", "lighting", "mood"]);
    expect(hits[1]?.queries).toEqual(["fox", "fox 2"]);
  });

  it("merges new pages into existing hits without duplicates", () => {
    const first = dedupeHits([{ result: result("1"), categoryId: "a", query: "q" }]);
    const more = dedupeHits(
      [
        { result: result("1"), categoryId: "a", query: "q" },
        { result: result("2"), categoryId: "a", query: "q" },
      ],
      first,
    );
    expect(more.map((h) => h.key)).toEqual(["test:1", "test:2"]);
    expect(resultKey({ provider: "p", id: "x" })).toBe("p:x");
  });
});

describe("text relevance ranking", () => {
  it("scores the fraction of query words in title and tags", () => {
    expect(textMatchScore(["red fox"], "Red Fox sleeping")).toBe(1);
    expect(textMatchScore(["red fox"], "A fox")).toBe(0.5);
    expect(textMatchScore(["red fox"], "", ["foxes", "red"])).toBe(1);
    expect(textMatchScore(["red fox"], "")).toBeNull();
  });

  it("demotes results that mention exclusions and sorts by score", () => {
    const hits = dedupeHits([
      { result: result("a", { title: "a cat" }), categoryId: "c", query: "red fox" },
      { result: result("b", { title: "red fox with people" }), categoryId: "c", query: "red fox" },
      { result: result("c", { title: "red fox" }), categoryId: "c", query: "red fox" },
    ]);
    const ranked = rankHits(hits, ["people"]);
    expect(ranked.map((h) => h.result.id)).toEqual(["c", "b", "a"]);
    expect(ranked[1]?.score).toBe(0.25);
  });
});

describe("search runner", () => {
  const categories: ReferenceCategory[] = [
    { id: "low", name: "Low", purpose: "", priority: "low", searchQueries: ["l1", "l2"] },
    {
      id: "off",
      name: "Off",
      purpose: "",
      priority: "high",
      searchQueries: ["o1"],
      enabled: false,
    },
    {
      id: "high",
      name: "High",
      purpose: "",
      priority: "high",
      searchQueries: ["h1", "h2", "h3", " "],
    },
  ];

  it("plans enabled categories by priority with a per-category query cap", () => {
    expect(buildSearchPlan(categories, 2)).toEqual([
      { categoryId: "high", query: "h1" },
      { categoryId: "high", query: "h2" },
      { categoryId: "low", query: "l1" },
      { categoryId: "low", query: "l2" },
    ]);
  });

  it("keeps going when individual queries fail, time out or are empty", async () => {
    const mock = createMockSearchProvider({ delayMs: 0, slowMs: 500 });
    const out = await runSearch({
      provider: mock,
      plan: [
        { categoryId: "a", query: "fox" },
        { categoryId: "a", query: "fox __error__" },
        { categoryId: "b", query: "tree __empty__" },
        { categoryId: "b", query: "tree __slow__" },
      ],
      timeoutMs: 50,
    });
    expect(out.raw).toHaveLength(MOCK_PAGE_SIZE);
    expect(out.errors.map((e) => e.query).sort()).toEqual(["fox __error__", "tree __slow__"]);
    expect(out.errors.find((e) => e.query === "tree __slow__")?.message).toMatch(/timed out/);
    expect(out.counts.find((c) => c.item.query === "tree __empty__")?.count).toBe(0);
  });

  it("stops sending requests after a rate limit", async () => {
    const search = vi.fn(async () => {
      throw new SearchProviderError("rate_limit", "slow down", { status: 429 });
    });
    const provider: ImageSearchProvider = { id: "p", displayName: "P", isLive: true, search };
    const out = await runSearch({
      provider,
      plan: [1, 2, 3, 4].map((i) => ({ categoryId: "c", query: `q${i}` })),
      concurrency: 1,
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(out.errors).toHaveLength(4);
    expect(out.errors.every((e) => e.retryable)).toBe(true);
  });

  it("reports progress and partial results, and builds ranked hits", async () => {
    const progress: number[] = [];
    const partial: number[] = [];
    const out = await runSearch({
      provider: createMockSearchProvider({ delayMs: 0 }),
      plan: [
        { categoryId: "a", query: "red fox" },
        { categoryId: "a", query: "red fox" },
      ],
      onProgress: (d) => progress.push(d),
      onResults: (r) => partial.push(r.length),
    });
    expect(progress).toEqual([1, 2]);
    expect(partial).toEqual([MOCK_PAGE_SIZE, MOCK_PAGE_SIZE * 2]);
    expect(buildHits(out.raw, null)).toHaveLength(MOCK_PAGE_SIZE); // identical queries dedupe
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const promise = runSearch({
      provider: createMockSearchProvider({ delayMs: 200 }),
      plan: [{ categoryId: "a", query: "fox" }],
      signal: controller.signal,
    });
    controller.abort();
    const out = await promise;
    expect(out.raw).toEqual([]);
  });
});

describe("web search fallback links", () => {
  it("builds encoded https search URLs instead of scraping", () => {
    for (const site of WEB_SEARCH_SITES) {
      const url = site.buildUrl("red fox & snow");
      expect(isSafeHttpUrl(url)).toBe(true);
      expect(url.startsWith("https://")).toBe(true);
      expect(url).not.toContain(" ");
    }
  });
});
