import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { Banner, EmptyState, ErrorBanner } from "../../components/ui";
import type { BoardItem, SavedReference } from "../../lib/types";
import { safeImageSrc } from "../../lib/url";
import { placeOnBoard } from "./boardActions";
import { BoardCard, groupColor } from "./BoardCard";
import { buildBoardExport, downloadJson, exportFileName } from "./exportBoard";
import { arrangeByGroup, boardExtent } from "./layout";
import { extractSwatches } from "./swatches";

export function BoardScreen() {
  const { backend, project, brief, setScreen, notify, reportError } = useApp();
  const projectId = project?.id ?? "";
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [refs, setRefs] = useState<SavedReference[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState("");
  const [swatches, setSwatches] = useState<Record<string, string[]>>({});
  const [groupLabels, setGroupLabels] = useState<{ name: string; x: number }[]>([]);

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    Promise.all([backend.listBoardItems(projectId), backend.listReferences(projectId)]).then(
      ([i, r]) => {
        if (!alive) return;
        setItems(i);
        setRefs(r);
        setLoadError(null);
      },
      (err) => alive && setLoadError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [backend, projectId, reloadToken]);

  const refById = useMemo(() => new Map(refs.map((r) => [r.id, r])), [refs]);
  const onBoard = useMemo(() => new Set((items ?? []).map((i) => i.referenceId)), [items]);
  const notOnBoard = refs.filter((r) => !onBoard.has(r.id));
  const groups = useMemo(() => {
    const fromItems = (items ?? []).map((i) => i.groupName).filter(Boolean);
    const fromBrief = (brief?.referenceCategories ?? []).map((c) => c.name);
    return [...new Set([...fromItems, ...fromBrief])].sort();
  }, [items, brief]);
  const usedGroups = useMemo(
    () => [...new Set((items ?? []).map((i) => i.groupName))].sort(),
    [items],
  );
  const hasDemo = (items ?? []).some((i) => refById.get(i.referenceId)?.isDemo);

  function replaceItem(next: BoardItem) {
    setItems((all) => (all ?? []).map((i) => (i.id === next.id ? next : i)));
  }

  async function move(item: BoardItem, x: number, y: number) {
    try {
      replaceItem(await backend.updateBoardItem(item.id, { positionX: x, positionY: y }));
    } catch (err) {
      reportError(err);
      void load();
    }
  }

  async function setGroup(item: BoardItem, groupName: string) {
    setGroupLabels([]);
    try {
      replaceItem(await backend.updateBoardItem(item.id, { groupName }));
    } catch (err) {
      reportError(err);
    }
  }

  async function saveNotes(reference: SavedReference, notes: string) {
    try {
      const updated = await backend.updateReferenceNotes(reference.id, notes);
      setRefs((all) => all.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      reportError(err);
    }
  }

  async function remove(item: BoardItem) {
    try {
      await backend.removeBoardItem(item.id);
      setItems((all) => (all ?? []).filter((i) => i.id !== item.id));
      notify("Removed from board (still saved in the project)");
    } catch (err) {
      reportError(err);
    }
  }

  async function arrange() {
    if (!items?.length) return;
    const { positions, groups: labels } = arrangeByGroup(items);
    try {
      const updated = await Promise.all(
        positions.map((p) =>
          backend.updateBoardItem(p.id, {
            positionX: p.positionX,
            positionY: p.positionY,
            sortOrder: p.sortOrder,
          }),
        ),
      );
      setItems(updated.sort((a, b) => a.sortOrder - b.sortOrder));
      setGroupLabels(labels);
    } catch (err) {
      reportError(err);
      void load();
    }
  }

  async function addSaved(reference: SavedReference) {
    try {
      const item = await placeOnBoard(backend, reference, reference.category ?? "");
      setItems((all) => [...(all ?? []), item]);
    } catch (err) {
      reportError(err);
    }
  }

  async function deleteSaved(reference: SavedReference) {
    try {
      await backend.deleteReference(reference.id);
      setRefs((all) => all.filter((r) => r.id !== reference.id));
    } catch (err) {
      reportError(err);
    }
  }

  async function colors(reference: SavedReference) {
    const src = safeImageSrc(reference.thumbnailUrl);
    if (!src) return notify("This reference has no preview image", "error");
    try {
      const list = await extractSwatches(src);
      setSwatches((s) => ({ ...s, [reference.id]: list }));
    } catch (err) {
      notify(`Colors unavailable: ${errorMessage(err)}`, "error");
    }
  }

  function exportJson() {
    if (!project || !items) return;
    downloadJson(exportFileName(project.name), buildBoardExport(project, brief, items, refs));
  }

  async function copyJson() {
    if (!project || !items) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(buildBoardExport(project, brief, items, refs), null, 2),
      );
      notify("Board metadata copied to the clipboard");
    } catch {
      notify("Could not access the clipboard", "error");
    }
  }

  if (!project) return null;
  const extent = boardExtent(items ?? []);

  return (
    <div className="board-layout">
      <section className="board-main" aria-labelledby="board-title">
        <div className="board-toolbar">
          <h1 id="board-title" style={{ margin: 0, fontSize: "1.15rem" }}>
            Board
          </h1>
          <span className="faint">{items?.length ?? 0} cards</span>
          <span className="spacer" />
          <label htmlFor="highlight" className="visually-hidden">
            Highlight group
          </label>
          <select
            id="highlight"
            value={highlight}
            onChange={(e) => setHighlight(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="">Highlight: all groups</option>
            {usedGroups.map((g) => (
              <option key={g} value={g}>
                {g || "Ungrouped"}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            onClick={arrange}
            disabled={!items?.length}
            title="Lay out cards in one column per group"
          >
            Arrange by group
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={exportJson}
            disabled={!items?.length}
            title="Download links, attribution and notes as JSON"
          >
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={copyJson}
            disabled={!items?.length}
          >
            Copy JSON
          </button>
        </div>
        {loadError && (
          <div style={{ padding: 16 }}>
            <ErrorBanner message={`Could not load the board: ${loadError}`} onRetry={load} />
          </div>
        )}
        {hasDemo && (
          <div style={{ padding: "8px 16px 0" }}>
            <Banner kind="demo">
              This board contains demo placeholder references from the mock provider.
            </Banner>
          </div>
        )}
        <div className="board-viewport">
          {items && items.length === 0 ? (
            <div style={{ padding: 32 }}>
              <EmptyState title="The board is empty">
                <p>
                  Add references from the Results screen, or from your saved references on the
                  right.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setScreen("results")}
                >
                  Go to Results
                </button>
              </EmptyState>
            </div>
          ) : (
            <div className="board-canvas" style={{ width: extent.width, height: extent.height }}>
              {groupLabels.map((g) => (
                <div key={g.name} className="board-group-label" style={{ left: g.x, top: 36 }}>
                  {g.name}
                </div>
              ))}
              {(items ?? []).map((item) => {
                const reference = refById.get(item.referenceId);
                if (!reference) return null;
                return (
                  <BoardCard
                    key={item.id}
                    item={item}
                    reference={reference}
                    groups={groups}
                    dimmed={highlight !== "" && item.groupName !== highlight}
                    swatches={swatches[reference.id]}
                    onMove={(x, y) => move(item, x, y)}
                    onNotes={(n) => saveNotes(reference, n)}
                    onGroup={(g) => setGroup(item, g)}
                    onRemove={() => remove(item)}
                    onOpen={() => backend.openExternal(reference.sourceUrl).catch(reportError)}
                    onSwatches={() => colors(reference)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="board-side" aria-label="Saved references and groups">
        <div>
          <h2>Groups</h2>
          {usedGroups.length === 0 && (
            <p className="faint">Type a group name on any card to create one.</p>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack">
            {usedGroups.map((g) => (
              <li key={g} className="row" style={{ gap: 6 }}>
                <span
                  className="swatch"
                  style={{ background: groupColor(g), width: 12, height: 12, borderRadius: "50%" }}
                />
                {g || "Ungrouped"}
                <span className="faint">
                  ({(items ?? []).filter((i) => i.groupName === g).length})
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Saved, not on board</h2>
          {notOnBoard.length === 0 && (
            <p className="faint">Nothing waiting. Use “Save” on a result to keep it for later.</p>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack">
            {notOnBoard.map((r) => (
              <li key={r.id} className="saved-item">
                {safeImageSrc(r.thumbnailUrl) ? (
                  <img src={safeImageSrc(r.thumbnailUrl)} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span />
                )}
                <div>
                  <div style={{ wordBreak: "break-word" }}>
                    {r.title} {r.isDemo && <span className="badge badge-demo">Demo</span>}
                  </div>
                  <div className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => addSaved(r)}
                    >
                      Add to board
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => deleteSaved(r)}
                      aria-label={`Delete saved reference ${r.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="faint">
          Drag a card by its title bar, or focus the title bar and use the arrow keys. Positions,
          groups and notes are saved automatically.
        </p>
      </aside>
    </div>
  );
}
