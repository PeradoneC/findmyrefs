import type {
  PinterestSearchParams,
  PinterestStatus,
  AiStatus,
  AppInfo,
  AppSettings,
  BoardItem,
  BoardItemPatch,
  BriefAnalysisOutput,
  CachedAnalysis,
  ImageAnalysisItem,
  ImageAnalysisItemResult,
  NewBoardItem,
  NewReference,
  NewSearchSession,
  Project,
  ProjectPatch,
  SavedReference,
  SearchSession,
  UsageRecord,
} from "../types";

/** Error shape returned by the backend (mirrors src-tauri/src/error.rs). */
export class BackendError extends Error {
  readonly kind: string;
  readonly code: string;

  constructor(kind: string, code: string, message: string) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
    this.code = code;
  }

  static from(err: unknown): BackendError {
    if (err instanceof BackendError) return err;
    if (err && typeof err === "object" && "message" in err) {
      const e = err as { kind?: unknown; code?: unknown; message?: unknown };
      return new BackendError(
        typeof e.kind === "string" ? e.kind : "internal",
        typeof e.code === "string" ? e.code : "internal",
        String(e.message),
      );
    }
    return new BackendError(
      "internal",
      "internal",
      typeof err === "string" ? err : "Unknown error",
    );
  }
}

/**
 * Everything the UI needs from the host. The desktop implementation talks to the
 * Rust backend (SQLite, OS credential store, paid API). The browser implementation
 * keeps data in localStorage and supports only the free providers.
 */
export interface Backend {
  readonly kind: "desktop" | "browser";

  getAppInfo(): Promise<AppInfo>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(name: string): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  recordSearchSession(input: NewSearchSession): Promise<SearchSession>;
  listSearchSessions(projectId: string): Promise<SearchSession[]>;

  saveReference(input: NewReference): Promise<SavedReference>;
  listReferences(projectId: string): Promise<SavedReference[]>;
  updateReferenceNotes(id: string, notes: string): Promise<SavedReference>;
  setReferenceAnalysis(id: string, analysisJson: string | null): Promise<void>;
  deleteReference(id: string): Promise<void>;

  listBoardItems(projectId: string): Promise<BoardItem[]>;
  addBoardItem(input: NewBoardItem): Promise<BoardItem>;
  updateBoardItem(id: string, patch: BoardItemPatch): Promise<BoardItem>;
  removeBoardItem(id: string): Promise<void>;

  listHiddenResults(projectId: string): Promise<string[]>;
  hideResult(projectId: string, resultKey: string): Promise<void>;
  unhideAllResults(projectId: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  getAiStatus(): Promise<AiStatus>;
  /** Write-only: the key is stored securely and never returned. */
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;

  listUsage(): Promise<UsageRecord[]>;
  clearUsage(): Promise<void>;

  getCachedAnalyses(cacheKeys: string[]): Promise<CachedAnalysis[]>;
  putCachedAnalysis(entry: CachedAnalysis): Promise<void>;
  clearAnalysisCache(): Promise<void>;

  /** Paid. The backend enforces all guardrails; `confirmed` records explicit user action. */
  anthropicAnalyzeBrief(prompt: string, confirmed: boolean): Promise<BriefAnalysisOutput>;
  /** Paid. One request per uncached image; cached results are returned for free. */
  anthropicAnalyzeImages(
    items: ImageAnalysisItem[],
    options: { confirmed: boolean; forceRefresh: boolean },
  ): Promise<ImageAnalysisItemResult[]>;

  /** Pinterest (free, official API; needs a token from an approved Pinterest app). */
  getPinterestStatus(): Promise<PinterestStatus>;
  /** Write-only: the token is stored securely and never returned. */
  setPinterestToken(token: string): Promise<void>;
  clearPinterestToken(): Promise<void>;
  /** Official keyword search. Returns the raw JSON body; callers must validate it. */
  pinterestSearch(params: PinterestSearchParams): Promise<string>;

  /** Opens an http(s) URL in the system browser. */
  openExternal(url: string): Promise<void>;
}
