// Pinterest keyword search through Pinterest's official API v5
// (`GET /v5/search/partner/pins`). Pinterest marks this endpoint as beta and "not
// available to all apps": it works only when the user's Pinterest developer app has
// been approved for it. The access token stays in the desktop backend, which makes
// the request; this module only normalizes the returned JSON (untrusted data).
// pinterest.com is never scraped.

import type { Backend } from "../../../lib/backend";
import { BackendError } from "../../../lib/backend";
import type { ImageSearchQuery, ImageSearchResult } from "../../../lib/types";
import { isHttpsUrl } from "../../../lib/url";
import { SearchProviderError, type ImageSearchProvider } from "./types";

export const PINTEREST_PAGE_SIZE = 25;

type Img = { url: string; width?: number; height?: number };

function str(v: unknown, max = 500): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100_000
    ? Math.round(v)
    : undefined;
}

/** Picks a mid-size https image from Pinterest's ImageSize object. */
function pickImage(images: unknown): Img | undefined {
  if (!images || typeof images !== "object") return undefined;
  const sizes = images as Record<string, unknown>;
  for (const key of ["600x", "400x300", "1200x", "150x150"]) {
    const entry = sizes[key];
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      if (isHttpsUrl(e.url)) return { url: e.url, width: num(e.width), height: num(e.height) };
    }
  }
  return undefined;
}

function imageOf(media: unknown): Img | undefined {
  if (!media || typeof media !== "object") return undefined;
  const m = media as Record<string, unknown>;
  const direct = pickImage(m.images);
  if (direct) return direct;
  // Carousels and mixed pins keep their images in `items`.
  if (Array.isArray(m.items)) {
    for (const item of m.items) {
      const img =
        item && typeof item === "object"
          ? pickImage((item as Record<string, unknown>).images)
          : undefined;
      if (img) return img;
    }
  }
  if (isHttpsUrl(m.cover_image_url)) return { url: m.cover_image_url };
  return undefined;
}

/** Normalizes one SummaryPin. Pins without a numeric id or a usable image are dropped. */
export function normalizePinterestPin(raw: unknown): ImageSearchResult | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id, 40);
  if (!id || !/^\d+$/.test(id)) return null;
  const image = imageOf(p.media);
  if (!image) return null;
  const title =
    str(p.title, 200) ?? str(p.alt_text, 200) ?? str(p.description, 200) ?? "Untitled pin";
  const description = str(p.description, 800) ?? "";
  const outbound = str(p.link, 2048);
  return {
    id,
    title,
    thumbnailUrl: image.url,
    // Link to the pin on Pinterest, which credits whoever saved it and links onward.
    sourceUrl: `https://www.pinterest.com/pin/${id}/`,
    provider: "pinterest",
    providerSource:
      outbound && isHttpsUrl(outbound)
        ? new URL(outbound).hostname.replace(/^www\./, "")
        : undefined,
    width: image.width,
    height: image.height,
    isDemo: false,
    // Words from the description help the text-match estimate.
    tags: description
      ? description
          .split(/[\s,#]+/)
          .filter((w) => w.length > 2)
          .slice(0, 30)
      : undefined,
  };
}

export function normalizePinterestResponse(body: string): {
  results: ImageSearchResult[];
  bookmark: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SearchProviderError("invalid_response", "Pinterest returned invalid JSON");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    throw new SearchProviderError("invalid_response", "Pinterest returned an unexpected response");
  }
  const obj = parsed as { items: unknown[]; bookmark?: unknown };
  return {
    results: obj.items.map(normalizePinterestPin).filter((r): r is ImageSearchResult => r !== null),
    bookmark: str(obj.bookmark, 2000) ?? null,
  };
}

/** Maps backend error codes (src-tauri/src/providers/pinterest.rs) to search errors. */
function toSearchError(err: unknown): SearchProviderError {
  if (err instanceof SearchProviderError) return err;
  const e = BackendError.from(err);
  switch (e.code) {
    case "pinterest_rate_limited":
      return new SearchProviderError("rate_limit", e.message, { status: 429 });
    case "pinterest_timeout":
      return new SearchProviderError("timeout", e.message);
    case "pinterest_network":
      return new SearchProviderError("network", e.message);
    case "pinterest_server_error":
      return new SearchProviderError("http", e.message, { status: 500 });
    case "pinterest_invalid_response":
      return new SearchProviderError("invalid_response", e.message);
    default:
      // No token, invalid token, not approved, bad request, browser preview.
      return new SearchProviderError("auth", e.message);
  }
}

export function createPinterestProvider(backend: Backend): ImageSearchProvider {
  // Pinterest pages with an opaque cursor; remember it per query so "Load more" works.
  const cursors = new Map<string, (string | null)[]>();
  return {
    id: "pinterest",
    displayName: "Pinterest (official API)",
    isLive: true,
    async search({ query, page = 1 }: ImageSearchQuery, signal?: AbortSignal) {
      const term = query.trim();
      if (!term) return [];
      const pageCursors = cursors.get(term) ?? [];
      let bookmark: string | null = null;
      if (page > 1) {
        bookmark = pageCursors[page - 2] ?? null;
        // No cursor means there is no next page (or earlier pages were never loaded).
        if (!bookmark) return [];
      }
      let body: string;
      try {
        body = await backend.pinterestSearch({ term, bookmark, limit: PINTEREST_PAGE_SIZE });
      } catch (err) {
        throw toSearchError(err);
      }
      if (signal?.aborted) throw new SearchProviderError("aborted", "The search was cancelled");
      const { results, bookmark: next } = normalizePinterestResponse(body);
      pageCursors[page - 1] = next;
      cursors.set(term, pageCursors);
      return results;
    },
  };
}
