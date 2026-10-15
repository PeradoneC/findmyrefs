import { invoke } from "@tauri-apps/api/core";
import { isSafeHttpUrl } from "../url";
import { BackendError, type Backend } from "./types";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw BackendError.from(err);
  }
}

/** Desktop backend: thin wrappers over the Tauri commands in src-tauri/src/commands.rs. */
export function createTauriBackend(): Backend {
  return {
    kind: "desktop",
    getAppInfo: () => call("get_app_info"),

    listProjects: () => call("list_projects"),
    getProject: (id) => call("get_project", { id }),
    createProject: (name) => call("create_project", { name }),
    updateProject: (id, patch) => call("update_project", { id, patch }),
    deleteProject: (id) => call("delete_project", { id }),

    recordSearchSession: (input) => call("record_search_session", { input }),
    listSearchSessions: (projectId) => call("list_search_sessions", { projectId }),

    saveReference: (input) => call("save_reference", { input }),
    listReferences: (projectId) => call("list_references", { projectId }),
    updateReferenceNotes: (id, notes) => call("update_reference_notes", { id, notes }),
    setReferenceAnalysis: (id, analysisJson) =>
      call("set_reference_analysis", { id, analysisJson }),
    deleteReference: (id) => call("delete_reference", { id }),

    listBoardItems: (projectId) => call("list_board_items", { projectId }),
    addBoardItem: (input) => call("add_board_item", { input }),
    updateBoardItem: (id, patch) => call("update_board_item", { id, patch }),
    removeBoardItem: (id) => call("remove_board_item", { id }),

    listHiddenResults: (projectId) => call("list_hidden_results", { projectId }),
    hideResult: (projectId, resultKey) => call("hide_result", { projectId, resultKey }),
    unhideAllResults: (projectId) => call("unhide_all_results", { projectId }),

    getSettings: () => call("get_settings"),
    updateSettings: (patch) => call("update_settings", { patch }),

    getAiStatus: () => call("get_ai_status"),
    setApiKey: (key) => call("set_api_key", { key }),
    clearApiKey: () => call("clear_api_key"),

    listUsage: () => call("list_usage"),
    clearUsage: () => call("clear_usage"),

    getCachedAnalyses: (cacheKeys) => call("get_cached_analyses", { cacheKeys }),
    putCachedAnalysis: (entry) => call("put_cached_analysis", { entry }),
    clearAnalysisCache: () => call("clear_analysis_cache"),

    anthropicAnalyzeBrief: (prompt, confirmed) =>
      call("anthropic_analyze_brief", { prompt, confirmed }),
    anthropicAnalyzeImages: (items, { confirmed, forceRefresh }) =>
      call("anthropic_analyze_images", { items, confirmed, forceRefresh }),

    getPinterestStatus: () => call("get_pinterest_status"),
    setPinterestToken: (token) => call("set_pinterest_token", { token }),
    clearPinterestToken: () => call("clear_pinterest_token"),
    pinterestSearch: (params) => call("pinterest_search", { params }),

    openExternal: async (url) => {
      if (!isSafeHttpUrl(url))
        throw new BackendError("invalid", "invalid", "Only http(s) links can be opened");
      await call("open_external", { url });
    },
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
