import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Backend } from "../lib/backend";
import { BackendError } from "../lib/backend";
import { parseArtBrief } from "../lib/schemas";
import type {
  AiStatus,
  AppSettings,
  ArtBrief,
  Project,
  QueryError,
  SearchHit,
  SearchProviderId,
} from "../lib/types";
import { getSearchProvider } from "../features/search/providers";
import { buildHits, runSearch, type PlanItem } from "../features/search/searchRunner";

export type Screen = "projects" | "discover" | "results" | "board" | "settings";

export type SearchState = {
  status: "running" | "done" | "cancelled";
  providerId: SearchProviderId;
  isDemo: boolean;
  providerName: string;
  plan: PlanItem[];
  page: number;
  hits: SearchHit[];
  errors: QueryError[];
  progress: { done: number; total: number };
};

type Toast = { id: number; message: string; kind: "info" | "error" };

type AppContextValue = {
  backend: Backend;
  screen: Screen;
  setScreen: (s: Screen) => void;
  settings: AppSettings | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings | null>;
  aiStatus: AiStatus | null;
  refreshAiStatus: () => Promise<unknown>;
  project: Project | null;
  brief: ArtBrief | null;
  briefError: string | null;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  setProject: (p: Project) => void;
  search: SearchState | null;
  startSearch: (
    plan: PlanItem[],
    providerId: SearchProviderId,
    opts?: { append?: boolean; page?: number },
  ) => Promise<void>;
  cancelSearch: () => void;
  notify: (message: string, kind?: "info" | "error") => void;
  reportError: (err: unknown) => void;
  dataVersion: number;
  bumpData: () => void;
};

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function errorMessage(err: unknown): string {
  if (err instanceof BackendError || err instanceof Error) return err.message;
  return BackendError.from(err).message;
}

export function AppProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>("projects");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [project, setProjectState] = useState<Project | null>(null);
  const [searches, setSearches] = useState<Record<string, SearchState>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const toastId = useRef(0);

  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      kind === "error" ? 8000 : 3500,
    );
  }, []);

  const reportError = useCallback((err: unknown) => notify(errorMessage(err), "error"), [notify]);

  const refreshAiStatus = useCallback(
    () => backend.getAiStatus().then(setAiStatus, reportError),
    [backend, reportError],
  );

  useEffect(() => {
    backend.getSettings().then(setSettings, reportError);
    backend.getAiStatus().then(setAiStatus, reportError);
  }, [backend, reportError]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      try {
        const next = await backend.updateSettings(patch);
        setSettings(next);
        await refreshAiStatus();
        return next;
      } catch (err) {
        reportError(err);
        return null;
      }
    },
    [backend, refreshAiStatus, reportError],
  );

  const openProject = useCallback(
    async (id: string) => {
      const p = await backend.getProject(id);
      if (!p) throw new BackendError("not_found", "not_found", "Project not found");
      setProjectState(p);
    },
    [backend],
  );

  const closeProject = useCallback(() => {
    abortRef.current?.abort();
    setProjectState(null);
    setScreen("projects");
  }, []);

  const briefJson = project?.structuredBriefJson ?? null;
  const parsed = useMemo(() => {
    if (!briefJson) return { brief: null, error: null };
    const r = parseArtBrief(briefJson);
    return r.ok
      ? { brief: r.value, error: null }
      : { brief: null, error: `Saved brief could not be read (${r.error})` };
  }, [briefJson]);

  const search = project ? (searches[project.id] ?? null) : null;

  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startSearch = useCallback(
    async (
      plan: PlanItem[],
      providerId: SearchProviderId,
      opts: { append?: boolean; page?: number } = {},
    ) => {
      if (!project || !settings) return;
      const projectId = project.id;
      const provider = getSearchProvider(providerId, backend);
      const page = opts.page ?? 1;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const previous = opts.append ? searches[projectId] : undefined;
      setSearches((s) => ({
        ...s,
        [projectId]: {
          status: "running",
          providerId,
          isDemo: !provider.isLive,
          providerName: provider.displayName,
          plan,
          page,
          hits: previous?.hits ?? [],
          errors: [],
          progress: { done: 0, total: plan.length },
        },
      }));
      const out = await runSearch({
        provider,
        plan,
        page,
        safeSearch: settings.safeSearch,
        signal: controller.signal,
        onProgress: (done, total) =>
          setSearches((s) => {
            const cur = s[projectId];
            return cur ? { ...s, [projectId]: { ...cur, progress: { done, total } } } : s;
          }),
        // Show results as they arrive instead of waiting for the slowest query.
        onResults: (rawSoFar) =>
          setSearches((s) => {
            const cur = s[projectId];
            return cur?.status === "running"
              ? {
                  ...s,
                  [projectId]: {
                    ...cur,
                    hits: buildHits(rawSoFar, parsed.brief, previous?.hits ?? []),
                  },
                }
              : s;
          }),
      });
      const hits = buildHits(out.raw, parsed.brief, previous?.hits ?? []);
      setSearches((s) => ({
        ...s,
        [projectId]: {
          status: controller.signal.aborted ? "cancelled" : "done",
          providerId,
          isDemo: !provider.isLive,
          providerName: provider.displayName,
          plan,
          page,
          hits,
          errors: out.errors,
          progress: { done: plan.length, total: plan.length },
        },
      }));
      // Record what was searched (metadata only).
      for (const { item, count } of out.counts) {
        backend
          .recordSearchSession({
            projectId,
            query: item.query,
            provider: providerId,
            category: item.categoryId,
            resultCount: count,
          })
          .catch(() => undefined);
      }
    },
    [backend, parsed.brief, project, searches, settings],
  );

  const value: AppContextValue = {
    backend,
    screen,
    setScreen,
    settings,
    updateSettings,
    aiStatus,
    refreshAiStatus,
    project,
    brief: parsed.brief,
    briefError: parsed.error,
    openProject,
    closeProject,
    setProject: setProjectState,
    search,
    startSearch,
    cancelSearch,
    notify,
    reportError,
    dataVersion,
    bumpData: () => setDataVersion((v) => v + 1),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "error" ? "toast-error" : ""}`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Dismiss"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
