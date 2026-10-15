import type { ImageSearchQuery, ImageSearchResult } from "../../../lib/types";

export interface ImageSearchProvider {
  id: string;
  displayName: string;
  /** Live providers return real results; demo providers return labeled sample data. */
  isLive: boolean;
  search(query: ImageSearchQuery, signal?: AbortSignal): Promise<ImageSearchResult[]>;
}

export type SearchErrorKind =
  | "rate_limit"
  | "timeout"
  | "network"
  | "http"
  | "invalid_response"
  | "aborted"
  /** Missing/invalid credentials or no access: retrying will not help. */
  | "auth";

export class SearchProviderError extends Error {
  readonly kind: SearchErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: SearchErrorKind,
    message: string,
    opts: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "SearchProviderError";
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }

  get retryable(): boolean {
    return (
      this.kind !== "invalid_response" &&
      this.kind !== "aborted" &&
      this.kind !== "auth" &&
      !(this.kind === "http" && this.status && this.status < 500)
    );
  }
}

/** Runs `fn` with a timeout; aborts the underlying request when the timer fires. */
export async function withTimeout<T>(
  ms: number,
  outer: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (timedOut)
      throw new SearchProviderError(
        "timeout",
        `The search timed out after ${Math.round(ms / 1000)} s`,
      );
    if (outer?.aborted) throw new SearchProviderError("aborted", "The search was cancelled");
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
