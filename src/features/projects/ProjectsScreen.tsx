import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { EmptyState, ErrorBanner, Modal } from "../../components/ui";
import type { Project } from "../../lib/types";

export function ProjectsScreen() {
  const {
    backend,
    project: current,
    openProject,
    closeProject,
    setScreen,
    notify,
    reportError,
  } = useApp();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Project | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    backend.listProjects().then(
      (list) => {
        if (!alive) return;
        setProjects(list);
        setLoadError(null);
      },
      (err) => alive && setLoadError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [backend, reloadToken]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await backend.createProject(name);
      setName("");
      await openProject(p.id);
      setScreen("discover");
    } catch (err) {
      reportError(err);
    } finally {
      setCreating(false);
    }
  }

  async function open(p: Project) {
    try {
      await openProject(p.id);
      setScreen("discover");
    } catch (err) {
      reportError(err);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await backend.deleteProject(toDelete.id);
      if (current?.id === toDelete.id) closeProject();
      notify(`Deleted "${toDelete.name}" and all its saved references and board data.`);
      setToDelete(null);
      load();
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <section className="screen" aria-labelledby="projects-title">
      <div className="screen-header">
        <div>
          <h1 id="projects-title">Projects</h1>
          <p>
            Each project keeps its brief, saved references and board. Everything is stored locally
            on this computer.
          </p>
        </div>
      </div>

      <form className="panel row" onSubmit={create} style={{ marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="new-project-name">New project name</label>
          <input
            id="new-project-name"
            type="text"
            value={name}
            maxLength={200}
            placeholder="e.g. Winter fox illustration"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!name.trim() || creating}
          style={{ alignSelf: "flex-end" }}
        >
          {creating ? "Creating…" : "Create project"}
        </button>
      </form>

      {loadError && (
        <ErrorBanner message={`Could not load projects: ${loadError}`} onRetry={load} />
      )}

      {projects === null && !loadError && <p className="muted">Loading projects…</p>}

      {projects?.length === 0 && (
        <EmptyState title="No projects yet">
          <p>
            Create a project above, describe the artwork you want to make, and the app will plan
            reference searches for it.
          </p>
        </EmptyState>
      )}

      {projects && projects.length > 0 && (
        <ul
          className="project-list"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
          aria-label="Projects"
        >
          {projects.map((p) => (
            <li key={p.id} className={`project-card ${current?.id === p.id ? "is-current" : ""}`}>
              <h3>{p.name}</h3>
              <p>{p.originalPrompt || "No brief yet."}</p>
              <span className="faint">Updated {new Date(p.updatedAt).toLocaleString()}</span>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => open(p)}>
                  {current?.id === p.id ? "Continue" : "Open"}
                </button>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setToDelete(p)}
                  aria-label={`Delete project ${p.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toDelete && (
        <Modal
          title="Delete project?"
          onClose={() => setToDelete(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setToDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                Delete permanently
              </button>
            </>
          }
        >
          <p>
            This removes <strong>{toDelete.name}</strong>, its brief, saved references, notes and
            board layout from this computer. It cannot be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}
