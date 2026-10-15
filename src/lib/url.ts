// URL helpers. Every URL from a search provider or AI response is untrusted.

const MAX_URL_LENGTH = 4096;
const MAX_INLINE_SVG_LENGTH = 20_000;

/** True for absolute http(s) URLs with a host. */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: unknown): value is string {
  return isSafeHttpUrl(value) && value.startsWith("https:");
}

/** Image sources we render: http(s) URLs or the mock provider's inline SVGs. */
export function safeImageSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("data:image/svg+xml")) {
    return value.length <= MAX_INLINE_SVG_LENGTH ? value : undefined;
  }
  return isSafeHttpUrl(value) ? value : undefined;
}

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i;

/**
 * Canonical form of a URL for duplicate detection: lowercase host, no "www.",
 * no fragment, no tracking parameters, sorted query, no trailing slash.
 */
export function normalizeUrlForDedupe(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${query}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

/** Short display host for attribution, e.g. "flickr.com". */
export function displayHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
