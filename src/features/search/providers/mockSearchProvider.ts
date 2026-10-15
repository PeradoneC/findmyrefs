// Demo search provider: deterministic sample results, no network access.
// Every result is marked `isDemo: true`, uses an example.com source link and an
// inline placeholder thumbnail, and says "Demo" in its title and license so it can
// never be mistaken for a live result.
//
// Special queries for testing error states: include "__error__", "__empty__" or
// "__slow__" in a query.

import type { ImageSearchQuery, ImageSearchResult } from "../../../lib/types";
import { SearchProviderError, type ImageSearchProvider } from "./types";

export const MOCK_PAGE_SIZE = 8;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "query"
  );
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
}

/** Placeholder SVG thumbnail with a deterministic gradient and a "DEMO" label. */
export function demoThumbnail(seed: string, label: string, width: number, height: number): string {
  const h = hash(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + (h % 80)) % 360;
  const vw = 300;
  const vh = Math.round((vw * height) / width);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},45%,38%)"/><stop offset="1" stop-color="hsl(${hue2},55%,22%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<circle cx="${(h % 200) + 50}" cy="${vh / 2}" r="${vh / 4}" fill="hsl(${hue2},60%,65%)" opacity="0.35"/>` +
    `<text x="12" y="26" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff" opacity="0.9">DEMO</text>` +
    `<text x="12" y="${vh - 14}" font-family="sans-serif" font-size="13" fill="#fff" opacity="0.85">${escapeXml(label.slice(0, 34))}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const SHAPES: [number, number][] = [
  [1200, 800],
  [800, 1200],
  [1000, 1000],
  [1600, 900],
  [900, 1350],
];

export function createMockSearchProvider(
  options: { delayMs?: number; slowMs?: number } = {},
): ImageSearchProvider {
  const delayMs = options.delayMs ?? 150;
  const slowMs = options.slowMs ?? 30_000;
  return {
    id: "mock",
    displayName: "Demo data (mock provider)",
    isLive: false,
    async search(
      { query, page = 1 }: ImageSearchQuery,
      signal?: AbortSignal,
    ): Promise<ImageSearchResult[]> {
      const q = query.trim();
      const wait = q.includes("__slow__") ? slowMs : delayMs;
      if (wait > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, wait);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new SearchProviderError("aborted", "The search was cancelled"));
          });
        });
      }
      if (q.includes("__error__")) {
        throw new SearchProviderError("http", "Demo provider error (simulated)", { status: 503 });
      }
      if (q.includes("__empty__") || !q || page > 3) return [];
      const base = slug(q);
      return Array.from({ length: MOCK_PAGE_SIZE }, (_, i) => {
        const n = (page - 1) * MOCK_PAGE_SIZE + i + 1;
        const [width, height] = SHAPES[hash(`${base}-${n}`) % SHAPES.length] ?? [1000, 1000];
        return {
          id: `${base}-${n}`,
          title: `Demo: ${q} #${n}`,
          thumbnailUrl: demoThumbnail(`${base}-${n}`, q, width, height),
          sourceUrl: `https://example.com/demo/${base}/${n}`,
          provider: "mock",
          creatorName: "Demo creator (not a real artist)",
          width,
          height,
          licenseLabel: "Demo placeholder - not a real image",
          isDemo: true,
          tags: q.toLowerCase().split(/\s+/).filter(Boolean),
        };
      });
    },
  };
}
