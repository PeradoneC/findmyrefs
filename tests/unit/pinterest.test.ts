import { describe, expect, it, vi } from "vitest";
import {
  createPinterestProvider,
  normalizePinterestPin,
  normalizePinterestResponse,
} from "../../src/features/search/providers/pinterestProvider";
import { getSearchProvider } from "../../src/features/search/providers";
import { SearchProviderError } from "../../src/features/search/providers/types";
import { runSearch } from "../../src/features/search/searchRunner";
import { createBrowserBackend } from "../../src/lib/backend/browserBackend";
import { BackendError, type Backend } from "../../src/lib/backend";
import type { PinterestSearchParams } from "../../src/lib/types";

// Shape follows SummaryPin in Pinterest's OpenAPI description (api-description/v5).
const pin = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Red fox ${id}`,
  description: "A red fox in the snow #wildlife",
  alt_text: null,
  link: "https://www.example-blog.com/fox",
  media: {
    media_type: "image",
    images: {
      "150x150": { url: `https://i.pinimg.com/150x150/${id}.jpg`, width: 150, height: 150 },
      "600x": { url: `https://i.pinimg.com/600x/${id}.jpg`, width: 600, height: 900 },
    },
  },
  ...extra,
});

function backendWith(search: (p: PinterestSearchParams) => Promise<string>): Backend {
  return { ...createBrowserBackend({ storage: null }), pinterestSearch: vi.fn(search) };
}

describe("Pinterest normalization", () => {
  it("maps a pin to a live result linking to the pin page", () => {
    const r = normalizePinterestPin(pin("123"));
    expect(r).toMatchObject({
      id: "123",
      title: "Red fox 123",
      provider: "pinterest",
      sourceUrl: "https://www.pinterest.com/pin/123/",
      thumbnailUrl: "https://i.pinimg.com/600x/123.jpg",
      width: 600,
      height: 900,
      providerSource: "example-blog.com",
      isDemo: false,
    });
    expect(r?.tags).toContain("wildlife");
  });

  it("uses carousel images and falls back to alt text for the title", () => {
    const r = normalizePinterestPin({
      id: "9",
      title: null,
      alt_text: "Fox drawing",
      media: {
        media_type: "multiple_images",
        items: [
          {
            item_type: "image",
            images: { "400x300": { url: "https://i.pinimg.com/a.jpg", width: 400, height: 300 } },
          },
        ],
      },
    });
    expect(r?.title).toBe("Fox drawing");
    expect(r?.thumbnailUrl).toBe("https://i.pinimg.com/a.jpg");
  });

  it("drops pins with invalid ids or without a safe https image", () => {
    expect(normalizePinterestPin(pin("abc"))).toBeNull();
    expect(
      normalizePinterestPin({ id: "1", media: { media_type: "image", images: {} } }),
    ).toBeNull();
    expect(
      normalizePinterestPin(
        pin("2", {
          media: { media_type: "image", images: { "600x": { url: "javascript:alert(1)" } } },
        }),
      ),
    ).toBeNull();
    expect(
      normalizePinterestPin(pin("3", { link: "javascript:alert(1)" }))?.providerSource,
    ).toBeUndefined();
    expect(normalizePinterestPin(null)).toBeNull();
  });

  it("validates the response shape", () => {
    const ok = normalizePinterestResponse(
      JSON.stringify({ items: [pin("1"), { bad: true }], bookmark: "next" }),
    );
    expect(ok.results).toHaveLength(1);
    expect(ok.bookmark).toBe("next");
    expect(() => normalizePinterestResponse("<html>")).toThrow(SearchProviderError);
    expect(() => normalizePinterestResponse(JSON.stringify({ data: [] }))).toThrow(
      SearchProviderError,
    );
  });
});

describe("Pinterest provider", () => {
  it("is a live provider that sends the term through the backend", async () => {
    const backend = backendWith(async () => JSON.stringify({ items: [pin("1")], bookmark: null }));
    const provider = createPinterestProvider(backend);
    expect(provider.isLive).toBe(true);
    const out = await provider.search({ query: "  red fox " });
    expect(out.map((r) => r.id)).toEqual(["1"]);
    expect(backend.pinterestSearch).toHaveBeenCalledWith({
      term: "red fox",
      bookmark: null,
      limit: 25,
    });
  });

  it("pages with Pinterest's bookmark cursor", async () => {
    const backend = backendWith(async (p) =>
      p.bookmark === "cursor-2"
        ? JSON.stringify({ items: [pin("2")], bookmark: null })
        : JSON.stringify({ items: [pin("1")], bookmark: "cursor-2" }),
    );
    const provider = createPinterestProvider(backend);
    expect((await provider.search({ query: "fox", page: 1 }))[0]?.id).toBe("1");
    expect((await provider.search({ query: "fox", page: 2 }))[0]?.id).toBe("2");
    // No cursor after the last page: nothing more is requested.
    expect(await provider.search({ query: "fox", page: 3 })).toEqual([]);
    expect(backend.pinterestSearch).toHaveBeenCalledTimes(2);
    // A page whose predecessor was never loaded is not requested either.
    expect(await provider.search({ query: "other", page: 2 })).toEqual([]);
  });

  it("maps backend errors to search errors", async () => {
    const fail = (code: string) =>
      createPinterestProvider(
        backendWith(async () => {
          throw new BackendError("provider", code, `msg ${code}`);
        }),
      ).search({ query: "fox" });
    await expect(fail("pinterest_not_approved")).rejects.toMatchObject({
      kind: "auth",
      retryable: false,
    });
    await expect(fail("pinterest_no_token")).rejects.toMatchObject({ kind: "auth" });
    await expect(fail("pinterest_token_invalid")).rejects.toMatchObject({ kind: "auth" });
    await expect(fail("pinterest_rate_limited")).rejects.toMatchObject({
      kind: "rate_limit",
      retryable: true,
    });
    await expect(fail("pinterest_network")).rejects.toMatchObject({ kind: "network" });
    await expect(fail("pinterest_timeout")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("stops after an access error instead of sending every query", async () => {
    const backend = backendWith(async () => {
      throw new BackendError(
        "provider",
        "pinterest_not_approved",
        "Pinterest refused the search (403).",
      );
    });
    const out = await runSearch({
      provider: createPinterestProvider(backend),
      plan: ["a", "b", "c"].map((q) => ({ categoryId: "c", query: q })),
      concurrency: 1,
    });
    expect(backend.pinterestSearch).toHaveBeenCalledTimes(1);
    expect(out.errors).toHaveLength(3);
    expect(out.errors[0]?.message).toMatch(/403/);
    expect(out.errors.every((e) => !e.retryable)).toBe(true);
  });

  it("is unavailable in the browser preview, which never stores tokens", async () => {
    const backend = createBrowserBackend({ storage: null });
    await expect(backend.setPinterestToken("pina_SECRET")).rejects.toMatchObject({
      code: "desktop_only",
    });
    expect((await backend.getPinterestStatus()).hasToken).toBe(false);
    await expect(
      getSearchProvider("pinterest", backend).search({ query: "fox" }),
    ).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("validates the Pinterest country setting", async () => {
    const backend = createBrowserBackend({ storage: null });
    expect((await backend.getSettings()).pinterestCountry).toBe("US");
    await expect(backend.updateSettings({ pinterestCountry: "Thailand" })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(
      (await backend.updateSettings({ pinterestCountry: "TH", searchProvider: "pinterest" }))
        .pinterestCountry,
    ).toBe("TH");
  });
});
