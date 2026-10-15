// Openverse (https://openverse.org) - an official, openly licensed media search API
// run by WordPress.org. Anonymous access is allowed (rate limited: roughly 20
// requests/minute and 200/day at the time of writing), so no credentials are needed.
// We show Openverse's own proxied thumbnails and link to the original landing page.

import type { ImageSearchQuery, ImageSearchResult } from "../../../lib/types";
import { isSafeHttpUrl, safeImageSrc } from "../../../lib/url";
import { SearchProviderError, withTimeout, type ImageSearchProvider } from "./types";

export const OPENVERSE_API = "https://api.openverse.org/v1/images/";
export const OPENVERSE_PAGE_SIZE = 20;

type Fetch = typeof fetch;

function str(v: unknown, max = 500): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000
    ? Math.round(v)
    : undefined;
}

export function licenseLabel(license?: string, version?: string): string | undefined {
  if (!license) return undefined;
  const l = license.toLowerCase();
  if (l === "cc0") return "CC0 (public domain dedication)";
  if (l === "pdm") return "Public Domain Mark";
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ""}`;
}

/** Normalizes one raw Openverse result. Returns null when required data is missing or unsafe. */
export function normalizeOpenverseResult(raw: unknown): ImageSearchResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 100);
  const landing = str(r.foreign_landing_url, 4096);
  const direct = str(r.url, 4096);
  const sourceUrl = isSafeHttpUrl(landing) ? landing : isSafeHttpUrl(direct) ? direct : undefined;
  if (!id || !sourceUrl) return null;
  const tags = Array.isArray(r.tags)
    ? r.tags
        .map((t) =>
          t && typeof t === "object" ? str((t as Record<string, unknown>).name, 60) : undefined,
        )
        .filter((t): t is string => Boolean(t))
        .slice(0, 30)
    : undefined;
  const creatorUrl = str(r.creator_url, 4096);
  const licenseUrl = str(r.license_url, 4096);
  return {
    id,
    title: str(r.title, 300) ?? "Untitled",
    thumbnailUrl: safeImageSrc(str(r.thumbnail, 4096)),
    sourceUrl,
    provider: "openverse",
    providerSource: str(r.source, 60) ?? str(r.provider, 60),
    creatorName: str(r.creator, 200),
    creatorUrl: isSafeHttpUrl(creatorUrl) ? creatorUrl : undefined,
    width: num(r.width),
    height: num(r.height),
    licenseLabel: licenseLabel(str(r.license, 20), str(r.license_version, 10)),
    licenseUrl: isSafeHttpUrl(licenseUrl) ? licenseUrl : undefined,
    isDemo: false,
    tags,
  };
}

export function normalizeOpenverseResponse(body: unknown): ImageSearchResult[] {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { results?: unknown }).results)
  ) {
    throw new SearchProviderError("invalid_response", "Openverse returned an unexpected response");
  }
  return (body as { results: unknown[] }).results
    .map(normalizeOpenverseResult)
    .filter((r): r is ImageSearchResult => r !== null);
}

export function createOpenverseProvider(
  options: { fetchImpl?: Fetch; timeoutMs?: number } = {},
): ImageSearchProvider {
  const fetchImpl: Fetch = options.fetchImpl ?? ((...args) => fetch(...args));
  // Openverse can take 10+ seconds per request under load.
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    id: "openverse",
    displayName: "Openverse (live, openly licensed)",
    isLive: true,
    async search({ query, page = 1, safeSearch = true }: ImageSearchQuery, signal?: AbortSignal) {
      const q = query.trim();
      if (!q) return [];
      const url = new URL(OPENVERSE_API);
      url.searchParams.set("q", q.slice(0, 200));
      url.searchParams.set("page", String(Math.max(1, Math.min(page, 20))));
      url.searchParams.set("page_size", String(OPENVERSE_PAGE_SIZE));
      url.searchParams.set("mature", safeSearch ? "false" : "true");

      return withTimeout(timeoutMs, signal, async (s) => {
        let response: Response;
        try {
          response = await fetchImpl(url.toString(), {
            signal: s,
            headers: { Accept: "application/json" },
          });
        } catch (err) {
          if (s.aborted) throw err;
          throw new SearchProviderError(
            "network",
            "Could not reach Openverse. Check your internet connection.",
          );
        }
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          throw new SearchProviderError(
            "rate_limit",
            "Openverse rate limit reached (anonymous access allows about 20 searches per minute). Wait a moment and retry, or search fewer queries.",
            {
              status: 429,
              retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
            },
          );
        }
        // Openverse returns 400 for pages past the end of the results.
        if (response.status === 400 && page > 1) return [];
        if (!response.ok) {
          throw new SearchProviderError(
            "http",
            `Openverse returned an error (${response.status})`,
            {
              status: response.status,
            },
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new SearchProviderError("invalid_response", "Openverse returned invalid JSON");
        }
        return normalizeOpenverseResponse(body);
      });
    },
  };
}
