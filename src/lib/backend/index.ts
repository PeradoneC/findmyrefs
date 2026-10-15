import { createBrowserBackend } from "./browserBackend";
import { createTauriBackend, isTauriRuntime } from "./tauriBackend";
import type { Backend } from "./types";

export type { Backend } from "./types";
export { BackendError } from "./types";

/** Desktop app -> Rust backend; plain browser (dev preview, E2E) -> browser backend. */
export function createBackend(): Backend {
  return isTauriRuntime() ? createTauriBackend() : createBrowserBackend();
}
