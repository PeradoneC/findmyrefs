// Browser backend used by `npm run dev` in a normal browser, the E2E tests and the
// unit tests. Data persists in localStorage (when available). It deliberately
// supports only the free providers: API keys are never stored in a browser.

import { isSafeHttpUrl, safeImageSrc } from "../url";
import type {
  AiStatus,
  AppSettings,
  BoardItem,
  CachedAnalysis,
  Project,
  SavedReference,
  SearchSession,
  UsageRecord,
} from "../types";
import { BackendError, type Backend } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: "mock",
  anthropicModel: "claude-opus-5-5",
  paidAiDisabled: false,
  paidWarningAcknowledged: false,
  maxImagesPerBatch: 3,
  monthlyRequestLimit: 50,
  monthlySpendTargetUsd: 5,
  limitOverrideMonth: null,
  searchProvider: "mock",
  safeSearch: true,
  queriesPerCategory: 2,
  pinterestCountry: "US",
};

type State = {
  version: 1;
  projects: Project[];
  sessions: SearchSession[];
  references: SavedReference[];
  boardItems: BoardItem[];
  hidden: { projectId: string; resultKey: string }[];
  settings: AppSettings;
  usage: UsageRecord[];
  cache: CachedAnalysis[];
};

const STORAGE_KEY = "findmyrefs:browser-backend:v1";

function emptyState(): State {
  return {
    version: 1,
    projects: [],
    sessions: [],
    references: [],
    boardItems: [],
    hidden: [],
    settings: { ...DEFAULT_SETTINGS },
    usage: [],
    cache: [],
  };
}

const now = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const invalid = (message: string) => new BackendError("invalid", "invalid", message);
const notFound = (message: string) => new BackendError("not_found", "not_found", message);
const desktopOnly = () =>
  new BackendError(
    "guard",
    "desktop_only",
    "The Anthropic API provider is only available in the desktop app. The browser preview supports the free Mock provider only.",
  );

function requireText(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw invalid(`${field} must not be empty`);
  if (trimmed.length > max) throw invalid(`${field} is too long (max ${max} characters)`);
  return trimmed;
}

function checkGeometry(x: number, y: number, w: number, h: number) {
  if (![x, y, w, h].every(Number.isFinite) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) {
    throw invalid("Board position is out of range");
  }
  if (w < 40 || w > 4000 || h < 40 || h > 4000) throw invalid("Card size is out of range");
}

function validateSettings(s: AppSettings) {
  if (!["mock", "anthropic"].includes(s.aiProvider)) throw invalid("Unknown AI provider");
  if (!Number.isInteger(s.maxImagesPerBatch) || s.maxImagesPerBatch < 1 || s.maxImagesPerBatch > 20)
    throw invalid("Images per batch must be between 1 and 20");
  if (
    !Number.isInteger(s.monthlyRequestLimit) ||
    s.monthlyRequestLimit < 0 ||
    s.monthlyRequestLimit > 100_000
  )
    throw invalid("Monthly request limit is out of range");
  if (
    !Number.isFinite(s.monthlySpendTargetUsd) ||
    s.monthlySpendTargetUsd < 0 ||
    s.monthlySpendTargetUsd > 100_000
  )
    throw invalid("Monthly spending target must be between 0 and 100,000");
  if (!["mock", "openverse", "pinterest"].includes(s.searchProvider))
    throw invalid("Unknown search provider");
  if (
    !Number.isInteger(s.queriesPerCategory) ||
    s.queriesPerCategory < 1 ||
    s.queriesPerCategory > 8
  )
    throw invalid("Queries per category must be between 1 and 8");
  if (!/^[A-Z]{2}$/.test(s.pinterestCountry))
    throw invalid("Pinterest country must be a two-letter code such as US or TH");
}

export type BrowserBackendOptions = {
  /** Storage to persist into; `null` keeps data in memory only (tests). */
  storage?: Storage | null;
};

export function createBrowserBackend(options: BrowserBackendOptions = {}): Backend {
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const state = load();

  function load(): State {
    if (!storage) return emptyState();
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as Partial<State>;
      if (parsed.version !== 1) return emptyState();
      return {
        ...emptyState(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      } as State;
    } catch {
      return emptyState();
    }
  }

  function save() {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked: keep working in memory.
    }
  }

  function touch(projectId: string) {
    const p = state.projects.find((x) => x.id === projectId);
    if (p) p.updatedAt = now();
  }

  const clone = <T>(v: T): T => structuredClone(v);

  const backend: Backend = {
    kind: "browser",

    async getAppInfo() {
      return {
        version: "browser-preview",
        dbPath: storage ? "browser localStorage" : "memory",
        schemaVersion: 1,
      };
    },

    async listProjects() {
      return clone([...state.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async getProject(id) {
      return clone(state.projects.find((p) => p.id === id) ?? null);
    },
    async createProject(name) {
      const ts = now();
      const project: Project = {
        id: newId(),
        name: requireText(name, "Project name", 200),
        originalPrompt: "",
        structuredBriefJson: null,
        createdAt: ts,
        updatedAt: ts,
      };
      state.projects.push(project);
      save();
      return clone(project);
    },
    async updateProject(id, patch) {
      const p = state.projects.find((x) => x.id === id);
      if (!p) throw notFound("Project not found");
      if (patch.name !== undefined) p.name = requireText(patch.name, "Project name", 200);
      if (patch.originalPrompt !== undefined) {
        if (patch.originalPrompt.length > 20_000)
          throw invalid("The brief is too long (max 20,000 characters)");
        p.originalPrompt = patch.originalPrompt;
      }
      if (patch.structuredBriefJson !== undefined) {
        if (patch.structuredBriefJson !== null) {
          try {
            JSON.parse(patch.structuredBriefJson);
          } catch {
            throw invalid("Structured brief is not valid JSON");
          }
        }
        p.structuredBriefJson = patch.structuredBriefJson;
      }
      p.updatedAt = now();
      save();
      return clone(p);
    },
    async deleteProject(id) {
      state.projects = state.projects.filter((p) => p.id !== id);
      state.sessions = state.sessions.filter((s) => s.projectId !== id);
      state.references = state.references.filter((r) => r.projectId !== id);
      state.boardItems = state.boardItems.filter((b) => b.projectId !== id);
      state.hidden = state.hidden.filter((h) => h.projectId !== id);
      save();
    },

    async recordSearchSession(input) {
      const session: SearchSession = {
        ...input,
        query: requireText(input.query, "Query", 500),
        id: newId(),
        createdAt: now(),
      };
      state.sessions.push(session);
      state.sessions = state.sessions.slice(-2000);
      save();
      return clone(session);
    },
    async listSearchSessions(projectId) {
      return clone(state.sessions.filter((s) => s.projectId === projectId).reverse());
    },

    async saveReference(input) {
      if (!isSafeHttpUrl(input.sourceUrl)) throw invalid("Only http(s) links are allowed");
      if (input.thumbnailUrl && !safeImageSrc(input.thumbnailUrl))
        throw invalid("Invalid thumbnail URL");
      const existing = state.references.find(
        (r) =>
          r.projectId === input.projectId &&
          r.provider === input.provider &&
          r.providerResultId === input.providerResultId,
      );
      if (existing) return clone(existing);
      const reference: SavedReference = {
        ...input,
        title: input.title.trim().slice(0, 500),
        id: newId(),
        userNotes: "",
        analysisJson: null,
        createdAt: now(),
      };
      state.references.push(reference);
      touch(input.projectId);
      save();
      return clone(reference);
    },
    async listReferences(projectId) {
      return clone(state.references.filter((r) => r.projectId === projectId));
    },
    async updateReferenceNotes(id, notes) {
      if (notes.length > 10_000) throw invalid("Notes are too long (max 10,000 characters)");
      const r = state.references.find((x) => x.id === id);
      if (!r) throw notFound("Reference not found");
      r.userNotes = notes;
      touch(r.projectId);
      save();
      return clone(r);
    },
    async setReferenceAnalysis(id, analysisJson) {
      const r = state.references.find((x) => x.id === id);
      if (r) {
        r.analysisJson = analysisJson;
        save();
      }
    },
    async deleteReference(id) {
      state.references = state.references.filter((r) => r.id !== id);
      state.boardItems = state.boardItems.filter((b) => b.referenceId !== id);
      save();
    },

    async listBoardItems(projectId) {
      return clone(
        state.boardItems
          .filter((b) => b.projectId === projectId)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
    },
    async addBoardItem(input) {
      checkGeometry(input.positionX, input.positionY, input.width, input.height);
      const ref = state.references.find((r) => r.id === input.referenceId);
      if (!ref) throw notFound("Reference not found");
      if (ref.projectId !== input.projectId)
        throw invalid("Reference belongs to a different project");
      const existing = state.boardItems.find(
        (b) => b.projectId === input.projectId && b.referenceId === input.referenceId,
      );
      if (existing) return clone(existing);
      const order =
        Math.max(
          -1,
          ...state.boardItems
            .filter((b) => b.projectId === input.projectId)
            .map((b) => b.sortOrder),
        ) + 1;
      const ts = now();
      const item: BoardItem = {
        ...input,
        groupName: input.groupName.trim().slice(0, 100),
        id: newId(),
        sortOrder: order,
        createdAt: ts,
        updatedAt: ts,
      };
      state.boardItems.push(item);
      touch(input.projectId);
      save();
      return clone(item);
    },
    async updateBoardItem(id, patch) {
      const item = state.boardItems.find((b) => b.id === id);
      if (!item) throw notFound("Board item not found");
      const next = { ...item, ...patch };
      if (patch.groupName !== undefined) next.groupName = patch.groupName.trim().slice(0, 100);
      checkGeometry(next.positionX, next.positionY, next.width, next.height);
      Object.assign(item, next, { updatedAt: now() });
      touch(item.projectId);
      save();
      return clone(item);
    },
    async removeBoardItem(id) {
      state.boardItems = state.boardItems.filter((b) => b.id !== id);
      save();
    },

    async listHiddenResults(projectId) {
      return state.hidden.filter((h) => h.projectId === projectId).map((h) => h.resultKey);
    },
    async hideResult(projectId, resultKey) {
      if (!state.hidden.some((h) => h.projectId === projectId && h.resultKey === resultKey)) {
        state.hidden.push({ projectId, resultKey });
        save();
      }
    },
    async unhideAllResults(projectId) {
      state.hidden = state.hidden.filter((h) => h.projectId !== projectId);
      save();
    },

    async getSettings() {
      return clone(state.settings);
    },
    async updateSettings(patch) {
      const next = { ...state.settings, ...patch };
      validateSettings(next);
      state.settings = next;
      save();
      return clone(next);
    },

    async getAiStatus(): Promise<AiStatus> {
      const month = now().slice(0, 7);
      const s = state.settings;
      const blocked =
        s.aiProvider === "mock"
          ? {
              code: "not_selected",
              reason: "Paid AI is not selected. The free Mock provider is active.",
            }
          : { code: "desktop_only", reason: desktopOnly().message };
      return {
        aiProvider: s.aiProvider,
        model: s.anthropicModel,
        hasApiKey: false,
        secureStorage: "Not available in the browser preview",
        paid: {
          available: false,
          blockedCode: blocked.code,
          blockedReason: blocked.reason,
          needsWarningAcknowledgement: !s.paidWarningAcknowledged,
        },
        month: { month, requests: 0, estimatedCostUsd: 0, requestsWithoutCost: 0 },
        pricesAsOf: "2026-10",
      };
    },
    async setApiKey() {
      throw desktopOnly();
    },
    async clearApiKey() {
      // Nothing is ever stored in the browser.
    },

    async listUsage() {
      return clone(state.usage);
    },
    async clearUsage() {
      state.usage = [];
      save();
    },

    async getCachedAnalyses(keys) {
      const wanted = new Set(keys);
      return clone(state.cache.filter((c) => wanted.has(c.cacheKey)));
    },
    async putCachedAnalysis(entry) {
      if (entry.provider === "anthropic") throw invalid("Paid analyses are cached by the backend");
      state.cache = state.cache.filter((c) => c.cacheKey !== entry.cacheKey);
      state.cache.push(entry);
      state.cache = state.cache.slice(-1000);
      save();
    },
    async clearAnalysisCache() {
      state.cache = [];
      save();
    },

    async anthropicAnalyzeBrief() {
      throw desktopOnly();
    },
    async anthropicAnalyzeImages() {
      throw desktopOnly();
    },

    async getPinterestStatus() {
      return {
        hasToken: false,
        secureStorage: "Not available in the browser preview",
        country: state.settings.pinterestCountry,
      };
    },
    async setPinterestToken() {
      throw new BackendError(
        "guard",
        "desktop_only",
        "Pinterest search is only available in the desktop app, which stores the token securely.",
      );
    },
    async clearPinterestToken() {
      // Nothing is ever stored in the browser.
    },
    async pinterestSearch() {
      throw new BackendError(
        "guard",
        "desktop_only",
        "Pinterest search is only available in the desktop app, which stores the token securely.",
      );
    },

    async openExternal(url) {
      if (!isSafeHttpUrl(url)) throw invalid("Only http(s) links can be opened");
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
  return backend;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "__findmyrefs_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
