import type { Backend } from "../../../lib/backend";
import type { SearchProviderId } from "../../../lib/types";
import { createMockSearchProvider } from "./mockSearchProvider";
import { createOpenverseProvider } from "./openverseProvider";
import { createPinterestProvider } from "./pinterestProvider";
import type { ImageSearchProvider } from "./types";

export const SEARCH_PROVIDER_OPTIONS: {
  id: SearchProviderId;
  label: string;
  description: string;
}[] = [
  {
    id: "mock",
    label: "Demo data (mock)",
    description: "Free, offline sample results. Not real images.",
  },
  {
    id: "openverse",
    label: "Openverse (live)",
    description:
      "Openly licensed images via the official Openverse API. No key needed; rate limited.",
  },
  {
    id: "pinterest",
    label: "Pinterest (official API, needs approval)",
    description:
      "Pinterest keyword search via the official API. Desktop app only. Needs an access token from a Pinterest developer app that Pinterest has approved for search (see Settings → Pinterest).",
  },
];

const cache = new Map<SearchProviderId, ImageSearchProvider>();
let pinterest: { backend: Backend; provider: ImageSearchProvider } | null = null;

export function getSearchProvider(id: SearchProviderId, backend: Backend): ImageSearchProvider {
  if (id === "pinterest") {
    // The provider keeps page cursors, so reuse it for the same backend.
    if (pinterest?.backend !== backend)
      pinterest = { backend, provider: createPinterestProvider(backend) };
    return pinterest.provider;
  }
  let provider = cache.get(id);
  if (!provider) {
    provider = id === "openverse" ? createOpenverseProvider() : createMockSearchProvider();
    cache.set(id, provider);
  }
  return provider;
}
