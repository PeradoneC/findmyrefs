import { useEffect } from "react";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { DiscoverScreen } from "../features/brief/DiscoverScreen";
import { ResultsScreen } from "../features/search/ResultsScreen";
import { BoardScreen } from "../features/board/BoardScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { FreeBadge, PaidBadge } from "../components/ui";
import { useApp, type Screen } from "./AppContext";

const NAV: { id: Screen; label: string; key: string; needsProject: boolean }[] = [
  { id: "projects", label: "Projects", key: "1", needsProject: false },
  { id: "discover", label: "Discover", key: "2", needsProject: true },
  { id: "results", label: "Results", key: "3", needsProject: true },
  { id: "board", label: "Board", key: "4", needsProject: true },
  { id: "settings", label: "Settings", key: "5", needsProject: false },
];

export function App() {
  const { screen, setScreen, project, settings, backend, search } = useApp();

  // Alt+1..5 switches screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const item = NAV.find((n) => n.key === e.key);
      if (item && (!item.needsProject || project)) {
        e.preventDefault();
        setScreen(item.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, setScreen]);

  const paid = settings?.aiProvider === "anthropic";

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          FindMyRefs
          <small>{project ? project.name : "No project open"}</small>
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-btn"
            aria-current={screen === item.id ? "page" : undefined}
            disabled={item.needsProject && !project}
            title={
              item.needsProject && !project
                ? "Open a project first"
                : `${item.label} (Alt+${item.key})`
            }
            onClick={() => setScreen(item.id)}
          >
            <span>
              {item.label}
              {item.id === "results" && search?.hits.length ? ` (${search.hits.length})` : ""}
            </span>
            <kbd>Alt+{item.key}</kbd>
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="row">
            AI: {paid ? <PaidBadge label="Anthropic API" /> : <FreeBadge label="Mock (free)" />}
          </div>
          <div className="row">
            Search:{" "}
            {settings?.searchProvider === "openverse" ? (
              <span className="badge badge-live">Openverse</span>
            ) : (
              <span className="badge badge-demo">Demo data</span>
            )}
          </div>
          {backend.kind === "browser" && (
            <div
              className="faint"
              title="Running in a plain browser: data is kept in this browser's local storage."
            >
              Browser preview mode
            </div>
          )}
        </div>
      </nav>
      <main className="main" id="main">
        {screen === "projects" && <ProjectsScreen />}
        {screen === "discover" && project && <DiscoverScreen key={project.id} />}
        {screen === "results" && project && <ResultsScreen key={project.id} />}
        {screen === "board" && project && <BoardScreen key={project.id} />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
